import { describe, expect, it } from "vitest";
import { s3LinkWindow } from "../../src/storage/s3Storage.driver";

/** How long plain S3 playback links may last (no CloudFront). */
describe("S3 presigned link lifetime", () => {
  const now = 1_800_000_000;

  it("with long-lived keys: the full wanted time, signed from the window start (stable URL)", () => {
    const want = now + 4 * 3600;
    const w = s3LinkWindow(now, want, 6 * 3600, undefined);
    expect(w.start % (6 * 3600)).toBe(0);
    expect(w.start + w.expiresIn).toBe(want);
  });

  it("with temporary (IAM role) credentials: never longer than they live, signed now", () => {
    const credsExpire = now + 50 * 60; // role credentials rotate in 50 min
    const w = s3LinkWindow(now, now + 4 * 3600, 6 * 3600, credsExpire);
    expect(w.start).toBe(now);
    expect(w.start + w.expiresIn).toBe(credsExpire - 60);
  });

  it("never more than the S3 maximum of 7 days", () => {
    const w = s3LinkWindow(now, now + 30 * 24 * 3600, undefined, undefined);
    expect(w.expiresIn).toBe(7 * 24 * 3600);
  });
});
