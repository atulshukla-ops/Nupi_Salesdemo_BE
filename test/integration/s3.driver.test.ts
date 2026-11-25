import { CreateBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * S3 driver against an S3-compatible server. Skipped unless S3_TEST_ENDPOINT is set, e.g.
 *   pip install "moto[server]" && moto_server -p 4566
 *   S3_TEST_ENDPOINT=http://localhost:4566 npm test
 */
const endpoint = process.env.S3_TEST_ENDPOINT;
const BUCKET = "sdr-driver-test";

describe.skipIf(!endpoint)("S3 storage driver", () => {
  let s3Driver: typeof import("../../src/storage/s3Storage.driver").s3Driver;
  let raw: S3Client;
  const KEY = "sales-demo/videos/test/v1/original.mp4";
  const MB5 = 5 * 1024 * 1024; // S3 minimum part size (except the last part)

  beforeAll(async () => {
    Object.assign(process.env, {
      STORAGE_DRIVER: "s3",
      S3_BUCKET: BUCKET,
      S3_ENDPOINT: endpoint,
      AWS_REGION: "ap-south-1",
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "test",
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "test"
    });
    s3Driver = (await import("../../src/storage/s3Storage.driver")).s3Driver;
    raw = new S3Client({ region: "ap-south-1", endpoint, forcePathStyle: true });
    await raw.send(new CreateBucketCommand({ Bucket: BUCKET, CreateBucketConfiguration: { LocationConstraint: "ap-south-1" } })).catch(() => undefined);
  });

  const put = async (url: string, body: Buffer) => {
    const r = await fetch(url, { method: "PUT", body });
    expect(r.status).toBe(200);
    return r.headers.get("etag")!;
  };

  it("multipart upload through presigned part URLs, with resume", async () => {
    const a = Buffer.alloc(MB5, 1);
    const b = Buffer.from("the last part can be small");
    const { uploadId } = await s3Driver.createMultipartUpload(KEY, "video/mp4");
    const e1 = await put(await s3Driver.presignUploadPart(KEY, uploadId, 1, 600), a);

    // resume: storage tells which parts it already has
    const have = await s3Driver.listParts(KEY, uploadId);
    expect(have).toEqual([{ partNumber: 1, etag: e1, size: MB5 }]);

    const e2 = await put(await s3Driver.presignUploadPart(KEY, uploadId, 2, 600), b);
    await s3Driver.completeMultipartUpload(KEY, uploadId, [
      { partNumber: 2, etag: e2 },
      { partNumber: 1, etag: e1 }
    ]);
    expect(await s3Driver.headObject(KEY)).toEqual({ size: MB5 + b.length });
    expect(await s3Driver.listParts(KEY, uploadId)).toEqual([]); // finished upload: nothing to resume
  });

  it("a wrong ETag is refused with a clear 400", async () => {
    const { uploadId } = await s3Driver.createMultipartUpload("sales-demo/videos/test/v9/original.mp4", "video/mp4");
    await put(await s3Driver.presignUploadPart("sales-demo/videos/test/v9/original.mp4", uploadId, 1, 600), Buffer.from("x"));
    await expect(
      s3Driver.completeMultipartUpload("sales-demo/videos/test/v9/original.mp4", uploadId, [{ partNumber: 1, etag: '"0000"' }])
    ).rejects.toMatchObject({ statusCode: 400 });
    await s3Driver.abortMultipartUpload("sales-demo/videos/test/v9/original.mp4", uploadId);
    await s3Driver.abortMultipartUpload("sales-demo/videos/test/v9/original.mp4", uploadId); // twice is fine
  });

  it("presigned GET plays the file (range requests work) and is stable within its window", async () => {
    const one = await s3Driver.presignGet(KEY, 3600, 6 * 3600);
    const two = await s3Driver.presignGet(KEY, 3600, 6 * 3600);
    expect(one.url).toBe(two.url);
    expect(one.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3600_000 - 5000);
    const r = await fetch(one.url, { headers: { Range: "bytes=0-9" } });
    expect(r.status).toBe(206);
    expect((await r.arrayBuffer()).byteLength).toBe(10);
  });

  it("worker side: upload a produced file and download it again", async () => {
    const src = path.join(os.tmpdir(), `sdr-s3-${process.pid}.bin`);
    await fs.writeFile(src, Buffer.alloc(1024, 7));
    await s3Driver.uploadFromFile(src, "sales-demo/videos/test/v1/play.mp4", "video/mp4");
    await s3Driver.downloadToFile("sales-demo/videos/test/v1/play.mp4", `${src}.copy`);
    expect((await fs.readFile(`${src}.copy`)).length).toBe(1024);
    await Promise.all([fs.rm(src), fs.rm(`${src}.copy`)]);
  });

  it("deletes one version folder only (v1 never matches v10)", async () => {
    await raw.send(new PutObjectCommand({ Bucket: BUCKET, Key: "sales-demo/videos/test/v10/play.mp4", Body: "keep" }));
    await s3Driver.deletePrefix("sales-demo/videos/test/v1/");
    expect(await s3Driver.headObject(KEY)).toBeNull();
    expect(await s3Driver.headObject("sales-demo/videos/test/v1/play.mp4")).toBeNull();
    expect(await s3Driver.headObject("sales-demo/videos/test/v10/play.mp4")).toEqual({ size: 4 });
  });

  it("a wrong bucket name is a clear setup error, not 'file not found'", async () => {
    const env = (await import("../../src/configs/env")).default;
    const real = env.s3Bucket;
    env.s3Bucket = "sdr-no-such-bucket";
    try {
      await expect(s3Driver.headObject(KEY)).rejects.toThrow(/does not exist\. Check S3_BUCKET/);
      await expect(s3Driver.listParts(KEY, "some-upload")).rejects.toThrow(/does not exist|NoSuchBucket/);
    } finally {
      env.s3Bucket = real;
    }
    expect(await s3Driver.headObject("sales-demo/videos/none/v1/play.mp4")).toBeNull(); // real bucket: plain "missing"
  });

  it("shared bucket guard: refuses keys outside the app's folder", async () => {
    await raw.send(new PutObjectCommand({ Bucket: BUCKET, Key: "other-app/important.txt", Body: "not ours" }));
    await expect(s3Driver.deletePrefix("other-app/")).rejects.toMatchObject({ statusCode: 400 });
    await expect(s3Driver.deletePrefix("sales-demo/")).rejects.toMatchObject({ statusCode: 400 }); // never the whole folder
    await expect(s3Driver.deletePrefix("sales-demo/../other-app/")).rejects.toMatchObject({ statusCode: 400 });
    await expect(s3Driver.presignGet("other-app/important.txt", 60)).rejects.toMatchObject({ statusCode: 400 });
    await expect(s3Driver.headObject("other-app/important.txt")).rejects.toMatchObject({ statusCode: 400 });
  });
});
