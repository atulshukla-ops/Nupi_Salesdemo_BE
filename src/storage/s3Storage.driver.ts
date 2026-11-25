import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListPartsCommand,
  S3Client,
  UploadPartCommand
} from "@aws-sdk/client-s3";
import { getSignedUrl as cloudfrontSign } from "@aws-sdk/cloudfront-signer";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl as s3Sign } from "@aws-sdk/s3-request-presigner";
import { createReadStream, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import env from "../configs/env";
import AppError from "../utils/appError";
import { expiry } from "./signing";
import { StorageDriver, UploadedPart } from "./storage.types";

/**
 * AWS S3 storage (also works with any S3-compatible server such as MinIO for local testing).
 *  - uploads: the browser PUTs each part straight to S3 with a presigned URL
 *  - playback: CloudFront signed URLs when CLOUDFRONT_* is set, otherwise S3 presigned URLs
 *  - credentials: the standard AWS chain (server/instance role on AWS, or AWS_ACCESS_KEY_ID/…)
 * Everything stays under STORAGE_PREFIX/ — the bucket is shared with other apps, so this driver
 * refuses to touch any key outside that folder.
 */

let client: S3Client | null = null;
const s3 = () =>
  (client ??= new S3Client({
    region: env.awsRegion,
    ...(env.s3Endpoint && { endpoint: env.s3Endpoint, forcePathStyle: env.s3ForcePathStyle })
  }));

const Bucket = () => env.s3Bucket;
const OWN_PREFIX = () => `${env.storagePrefix}/`;
const MAX_PRESIGN_SEC = 7 * 24 * 60 * 60; // S3 limit for presigned URLs

/** Guard for the shared bucket: only our folder, never "../" tricks. */
const own = (key: string) => {
  if (!key.startsWith(OWN_PREFIX()) || key.length <= OWN_PREFIX().length || key.split("/").includes("..")) {
    throw new AppError(400, "Invalid storage key");
  }
  return key;
};

const errName = (e: unknown) => (e as { name?: string })?.name;
const isMissing = (e: unknown) => {
  const name = errName(e);
  if (name === "NoSuchBucket") return false; // wrong S3_BUCKET: a setup problem, never "not found"
  return name === "NoSuchUpload" || name === "NotFound" || name === "NoSuchKey" || (e as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404;
};

/**
 * HEAD requests have no body, so a missing bucket also comes back as plain "NotFound". Before
 * answering "no such file", make sure the bucket itself exists (checked once). Uses a listing of
 * our own folder, which the IAM policy allows (HeadBucket would need wider permissions).
 */
const bucketChecked = new Map<string, Promise<void>>();
export const assertBucket = () => {
  const bucket = Bucket();
  let check = bucketChecked.get(bucket);
  if (!check) {
    check = s3()
      .send(new ListObjectsV2Command({ Bucket: bucket, Prefix: OWN_PREFIX(), MaxKeys: 1 }))
      .then(() => undefined)
      .catch((e) => {
        bucketChecked.delete(bucket);
        if (errName(e) === "NoSuchBucket") throw new Error(`S3 bucket "${bucket}" does not exist. Check S3_BUCKET and AWS_REGION.`);
        throw e;
      });
    bucketChecked.set(bucket, check);
  }
  return check;
};

/**
 * Plain S3 links are signed with the server's credentials and stop working when those expire.
 * An IAM role's credentials are temporary (they rotate every few hours), so a link must never
 * claim to last longer than the credentials that signed it. Returns when to sign and for how long.
 */
export const s3LinkWindow = (nowSec: number, wantedExpSec: number, alignSec: number | undefined, credentialsExpSec?: number) => {
  // Aligned (cacheable) links are signed from the start of the window, but only with long-lived keys.
  const start = alignSec && !credentialsExpSec ? Math.floor(nowSec / alignSec) * alignSec : nowSec;
  const limit = credentialsExpSec ? credentialsExpSec - 60 : Infinity;
  const until = Math.min(wantedExpSec, limit, start + MAX_PRESIGN_SEC);
  return { start, expiresIn: Math.max(60, until - start) };
};

/** CloudFront private key from CLOUDFRONT_PRIVATE_KEY (PEM; "\n" written as \\n in .env is fine). */
const cloudfrontKey = () => env.cloudfrontPrivateKey.replace(/\\n/g, "\n");
const useCloudFront = () => !!(env.cloudfrontDomain && env.cloudfrontKeyPairId && env.cloudfrontPrivateKey);

export const s3Driver: StorageDriver = {
  name: "s3",

  async createMultipartUpload(key, mimeType) {
    const r = await s3().send(new CreateMultipartUploadCommand({ Bucket: Bucket(), Key: own(key), ContentType: mimeType }));
    if (!r.UploadId) throw new Error("S3 did not return an upload id");
    return { uploadId: r.UploadId };
  },

  async presignUploadPart(key, uploadId, partNumber, expiresInSec) {
    return s3Sign(s3(), new UploadPartCommand({ Bucket: Bucket(), Key: own(key), UploadId: uploadId, PartNumber: partNumber }), {
      expiresIn: expiresInSec
    });
  },

  async listParts(key, uploadId) {
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    try {
      do {
        const r = await s3().send(new ListPartsCommand({ Bucket: Bucket(), Key: own(key), UploadId: uploadId, PartNumberMarker: marker }));
        for (const p of r.Parts ?? []) parts.push({ partNumber: p.PartNumber!, etag: p.ETag!, size: p.Size ?? 0 });
        marker = r.IsTruncated ? r.NextPartNumberMarker : undefined;
      } while (marker);
    } catch (e) {
      if (isMissing(e)) {
        await assertBucket();
        return [];
      }
      throw e;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  },

  async completeMultipartUpload(key, uploadId, parts) {
    try {
      await s3().send(
        new CompleteMultipartUploadCommand({
          Bucket: Bucket(),
          Key: own(key),
          UploadId: uploadId,
          MultipartUpload: { Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) }
        })
      );
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === "InvalidPart" || name === "InvalidPartOrder") throw new AppError(400, "A part is missing or its ETag does not match");
      if (name === "EntityTooSmall") throw new AppError(400, "Parts are smaller than storage allows (5 MB minimum except the last)");
      if (isMissing(e)) throw new AppError(404, "Upload not found or already finished");
      throw e;
    }
  },

  async abortMultipartUpload(key, uploadId) {
    try {
      await s3().send(new AbortMultipartUploadCommand({ Bucket: Bucket(), Key: own(key), UploadId: uploadId }));
    } catch (e) {
      if (!isMissing(e)) throw e;
    }
  },

  async headObject(key) {
    try {
      const r = await s3().send(new HeadObjectCommand({ Bucket: Bucket(), Key: own(key) }));
      return { size: r.ContentLength ?? 0 };
    } catch (e) {
      if (isMissing(e)) {
        await assertBucket();
        return null;
      }
      throw e;
    }
  },

  async presignGet(key, expiresInSec, alignSec) {
    own(key);
    const exp = expiry(expiresInSec, alignSec); // unix seconds
    if (useCloudFront()) {
      const url = cloudfrontSign({
        url: `https://${env.cloudfrontDomain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`,
        keyPairId: env.cloudfrontKeyPairId,
        privateKey: cloudfrontKey(),
        dateLessThan: new Date(exp * 1000)
      });
      return { url, expiresAt: new Date(exp * 1000) };
    }
    // Plain S3 (no CloudFront): see s3LinkWindow for how long a link can honestly last.
    const credentials = await s3().config.credentials();
    const credsExp = credentials.expiration ? Math.floor(credentials.expiration.getTime() / 1000) : undefined;
    const { start, expiresIn } = s3LinkWindow(Math.floor(Date.now() / 1000), exp, alignSec, credsExp);
    const url = await s3Sign(s3(), new GetObjectCommand({ Bucket: Bucket(), Key: key }), {
      expiresIn,
      signingDate: new Date(start * 1000)
    });
    return { url, expiresAt: new Date((start + expiresIn) * 1000) };
  },

  async deletePrefix(prefix) {
    const p = own(prefix.endsWith("/") ? prefix : `${prefix}/`);
    let token: string | undefined;
    do {
      const r = await s3().send(new ListObjectsV2Command({ Bucket: Bucket(), Prefix: p, ContinuationToken: token }));
      const keys = (r.Contents ?? []).map((o) => ({ Key: o.Key! }));
      if (keys.length) {
        // With Quiet, S3 still answers 200 and lists only the objects it could NOT delete.
        const d = await s3().send(new DeleteObjectsCommand({ Bucket: Bucket(), Delete: { Objects: keys, Quiet: true } }));
        if (d.Errors?.length) {
          const first = d.Errors[0];
          throw new Error(`Could not delete ${d.Errors.length} file(s) under ${p} (first: ${first.Key}: ${first.Code} ${first.Message ?? ""})`.trim());
        }
      }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
  },

  async downloadToFile(key, destination) {
    const r = await s3().send(new GetObjectCommand({ Bucket: Bucket(), Key: own(key) }));
    if (!r.Body) throw new Error(`S3 object ${key} has no body`);
    await pipeline(r.Body as Readable, createWriteStream(destination));
  },

  async uploadFromFile(source, key, contentType) {
    // Handles big files in parts automatically (converted videos can be several GB).
    await new Upload({
      client: s3(),
      params: { Bucket: Bucket(), Key: own(key), Body: createReadStream(source), ContentType: contentType },
      queueSize: 4,
      partSize: 16 * 1024 * 1024
    }).done();
  }
};
