import { afterEach, describe, expect, it, vi } from "vitest";

describe("settings and storage keys", () => {
  afterEach(() => {
    delete process.env.UPLOAD_ABANDON_HOURS;
    delete process.env.PROCESSING_REQUEUE_MINUTES;
    vi.resetModules();
  });

  it("blank housekeeping values in .env fall back to the defaults (never 0)", async () => {
    process.env.UPLOAD_ABANDON_HOURS = "";
    process.env.PROCESSING_REQUEUE_MINUTES = "";
    vi.resetModules();
    const env = (await import("../../src/configs/env")).default;
    expect(env.uploadAbandonHours).toBe(24);
    expect(env.processingRequeueMinutes).toBe(60);
  });

  it("a version's folder ends with a slash, so v1 never matches v10 on S3", async () => {
    const { versionPrefix } = await import("../../src/storage");
    expect(versionPrefix("abc", 1)).toBe("sales-demo/videos/abc/v1/");
    expect("sales-demo/videos/abc/v10/play.mp4".startsWith(versionPrefix("abc", 1))).toBe(false);
  });
});
