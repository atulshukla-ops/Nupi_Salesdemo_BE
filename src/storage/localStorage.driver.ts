import { createHash, randomUUID } from "crypto";
import { createReadStream, createWriteStream, promises as fs } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import env from "../configs/env";
import AppError from "../utils/appError";
import { expiry, sign } from "./signing";
import { StorageDriver, UploadedPart } from "./storage.types";

/**
 * Development storage: objects live under LOCAL_STORAGE_DIR, multipart uploads under
 * LOCAL_STORAGE_DIR/.multipart/<uploadId>/. Mirrors S3 behaviour closely enough that the
 * frontend upload code is identical for both drivers.
 */
const root = () => path.resolve(env.localStorageDir);
const multipartDir = (uploadId: string) => path.join(root(), ".multipart", uploadId);

/** Resolves an object key to a path, refusing anything that would escape the storage folder. */
export const objectPath = (key: string) => {
  const p = path.resolve(root(), key);
  if (!p.startsWith(root() + path.sep)) throw new AppError(400, "Invalid storage key");
  return p;
};

const assertUploadId = (uploadId: string) => {
  if (!/^[0-9a-f-]{36}$/.test(uploadId)) throw new AppError(400, "Invalid upload id");
};

const readMeta = async (uploadId: string): Promise<{ key: string; mimeType: string } | null> => {
  assertUploadId(uploadId);
  try {
    return JSON.parse(await fs.readFile(path.join(multipartDir(uploadId), "meta.json"), "utf8"));
  } catch {
    return null;
  }
};

/** Stores one part (called by the signed PUT endpoint). Returns its ETag (md5, like S3). */
export const writePart = async (uploadId: string, partNumber: number, body: Readable, maxBytes: number) => {
  const meta = await readMeta(uploadId);
  if (!meta) throw new AppError(404, "Upload not found or already finished");
  const dir = multipartDir(uploadId);
  const tmp = path.join(dir, `${partNumber}.part.${randomUUID()}.tmp`);
  const md5 = createHash("md5");
  let size = 0;
  let tooLarge = false;
  try {
    // The request stream is read to the end even when the part turns out too large: tearing the
    // connection down mid-request would prevent the client from receiving the 413 answer.
    await pipeline(
      body,
      async function* (source) {
        for await (const chunk of source) {
          size += chunk.length;
          if (size > maxBytes) {
            tooLarge = true;
            continue; // discard the rest
          }
          md5.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(tmp)
    );
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
  if (tooLarge) {
    await fs.rm(tmp, { force: true });
    throw new AppError(413, `Part is larger than the allowed ${maxBytes} bytes`);
  }
  if (size === 0) {
    await fs.rm(tmp, { force: true });
    throw new AppError(400, "Part is empty");
  }
  const etag = `"${md5.digest("hex")}"`;
  // Retrying a part simply replaces it, as on S3.
  await fs.rename(tmp, path.join(dir, `${partNumber}.part`));
  await fs.writeFile(path.join(dir, `${partNumber}.etag`), JSON.stringify({ etag, size }));
  return etag;
};

export const localDriver: StorageDriver = {
  name: "local",

  async createMultipartUpload(key, mimeType) {
    objectPath(key); // validate key early
    const uploadId = randomUUID();
    await fs.mkdir(multipartDir(uploadId), { recursive: true });
    await fs.writeFile(
      path.join(multipartDir(uploadId), "meta.json"),
      JSON.stringify({ key, mimeType, createdAt: new Date().toISOString() })
    );
    return { uploadId };
  },

  async presignUploadPart(_key, uploadId, partNumber, expiresInSec) {
    const exp = expiry(expiresInSec);
    const sig = sign(`PUT\n${uploadId}\n${partNumber}\n${exp}`);
    return `${env.publicBaseUrl}/api/storage-local/parts/${uploadId}/${partNumber}?exp=${exp}&sig=${sig}`;
  },

  async listParts(_key, uploadId) {
    if (!(await readMeta(uploadId))) return [];
    const files = await fs.readdir(multipartDir(uploadId));
    const parts: UploadedPart[] = [];
    for (const f of files.filter((name) => /^\d+\.etag$/.test(name))) {
      const { etag, size } = JSON.parse(await fs.readFile(path.join(multipartDir(uploadId), f), "utf8"));
      parts.push({ partNumber: Number(f.split(".")[0]), etag, size });
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  },

  async completeMultipartUpload(key, uploadId, parts) {
    const meta = await readMeta(uploadId);
    if (!meta || meta.key !== key) throw new AppError(404, "Upload not found or already finished");
    const stored = new Map((await this.listParts(key, uploadId)).map((p) => [p.partNumber, p.etag]));
    for (const p of parts) {
      if (stored.get(p.partNumber) !== p.etag) {
        throw new AppError(400, `Part ${p.partNumber} is missing or its ETag does not match`);
      }
    }
    const target = objectPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    const out = createWriteStream(tmp);
    try {
      for (const p of [...parts].sort((a, b) => a.partNumber - b.partNumber)) {
        await pipeline(createReadStream(path.join(multipartDir(uploadId), `${p.partNumber}.part`)), out, { end: false });
      }
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
      await fs.rename(tmp, target);
    } catch (error) {
      out.destroy();
      await fs.rm(tmp, { force: true });
      throw error;
    }
    await fs.rm(multipartDir(uploadId), { recursive: true, force: true });
  },

  async abortMultipartUpload(_key, uploadId) {
    assertUploadId(uploadId);
    await fs.rm(multipartDir(uploadId), { recursive: true, force: true });
  },

  async headObject(key) {
    try {
      const stat = await fs.stat(objectPath(key));
      return stat.isFile() ? { size: stat.size } : null;
    } catch {
      return null;
    }
  },

  async presignGet(key, expiresInSec, alignSec) {
    objectPath(key); // validate
    const exp = expiry(expiresInSec, alignSec);
    const sig = sign(`GET\n${key}\n${exp}`);
    return {
      url: `${env.publicBaseUrl}/api/storage-local/objects/${key.split("/").map(encodeURIComponent).join("/")}?exp=${exp}&sig=${sig}`,
      expiresAt: new Date(exp * 1000)
    };
  },

  async deletePrefix(prefix) {
    await fs.rm(objectPath(prefix.replace(/\/+$/, "")), { recursive: true, force: true });
  },

  async downloadToFile(key, destination) {
    await fs.copyFile(objectPath(key), destination);
  },

  async uploadFromFile(source, key) {
    const target = objectPath(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${randomUUID()}.tmp`;
    await fs.copyFile(source, tmp);
    await fs.rename(tmp, target);
  }
};

/** Multipart upload folders on disk with their creation time (used by the cleanup job to find orphans). */
export const listMultipartUploads = async () => {
  let ids: string[];
  try {
    ids = (await fs.readdir(path.join(root(), ".multipart"))).filter((d) => /^[0-9a-f-]{36}$/.test(d));
  } catch {
    return [];
  }
  return Promise.all(
    ids.map(async (uploadId) => ({ uploadId, createdAt: (await fs.stat(multipartDir(uploadId))).birthtime }))
  );
};
