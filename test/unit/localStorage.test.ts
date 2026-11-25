import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { afterAll, describe, expect, it } from "vitest";
import { localDriver, objectPath, writePart } from "../../src/storage/localStorage.driver";

const body = (s: string | Buffer) => Readable.from([Buffer.from(s)]);

describe("local storage driver (stand-in for S3)", () => {
  afterAll(() => fs.rm(process.env.LOCAL_STORAGE_DIR as string, { recursive: true, force: true }));

  it("multipart upload: parts sent in any order are joined in order", async () => {
    const key = "sales-demo/videos/test/v1/original.mp4";
    const { uploadId } = await localDriver.createMultipartUpload(key, "video/mp4");
    const e2 = await writePart(uploadId, 2, body("world"), 1024);
    const e1 = await writePart(uploadId, 1, body("hello "), 1024);
    expect(e1).toMatch(/^"[0-9a-f]{32}"$/);

    const parts = await localDriver.listParts(key, uploadId);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2]);

    await localDriver.completeMultipartUpload(key, uploadId, [
      { partNumber: 2, etag: e2 },
      { partNumber: 1, etag: e1 }
    ]);
    expect(await fs.readFile(objectPath(key), "utf8")).toBe("hello world");
    expect(await localDriver.headObject(key)).toEqual({ size: 11 });
    expect(await localDriver.listParts(key, uploadId)).toEqual([]); // upload folder removed
  });

  it("refuses a wrong ETag, an oversize part and an empty part", async () => {
    const key = "sales-demo/videos/test2/v1/original.mp4";
    const { uploadId } = await localDriver.createMultipartUpload(key, "video/mp4");
    await writePart(uploadId, 1, body("abc"), 1024);
    await expect(localDriver.completeMultipartUpload(key, uploadId, [{ partNumber: 1, etag: '"nope"' }])).rejects.toThrow(/ETag/);
    await expect(writePart(uploadId, 2, body(Buffer.alloc(2000)), 1024)).rejects.toMatchObject({ statusCode: 413 });
    await expect(writePart(uploadId, 3, body(""), 1024)).rejects.toMatchObject({ statusCode: 400 });
    await localDriver.abortMultipartUpload(key, uploadId);
    await expect(writePart(uploadId, 1, body("x"), 1024)).rejects.toMatchObject({ statusCode: 404 });
  });

  it("keys cannot escape the storage folder", () => {
    expect(() => objectPath("../outside.txt")).toThrow(/Invalid storage key/);
    expect(() => objectPath("a/../../outside.txt")).toThrow(/Invalid storage key/);
  });

  it("signed GET URLs point at this API and expire", async () => {
    const { url, expiresAt } = await localDriver.presignGet("sales-demo/videos/x/v1/play.mp4", 60);
    expect(url).toMatch(/^http:\/\/localhost:8130\/api\/storage-local\/objects\/sales-demo\/videos\/x\/v1\/play\.mp4\?exp=\d+&sig=/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("upload, download and delete a folder", async () => {
    const src = path.join(os.tmpdir(), `sdr-src-${process.pid}.txt`);
    await fs.writeFile(src, "data");
    await localDriver.uploadFromFile(src, "sales-demo/videos/y/v1/thumb.jpg");
    const dest = `${src}.copy`;
    await localDriver.downloadToFile("sales-demo/videos/y/v1/thumb.jpg", dest);
    expect(await fs.readFile(dest, "utf8")).toBe("data");
    await localDriver.deletePrefix("sales-demo/videos/y/");
    expect(await localDriver.headObject("sales-demo/videos/y/v1/thumb.jpg")).toBeNull();
    await Promise.all([fs.rm(src), fs.rm(dest)]);
  });
});
