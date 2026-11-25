import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canRemux, extractThumbnail, PermanentVideoError, probe, remuxFastStart, transcodeToMp4 } from "../../src/utils/ffmpeg";

/** Video conversion used by the worker, on tiny generated test videos. */
const ffmpeg = process.env.FFMPEG_PATH || (require("ffmpeg-static") as string);
const dir = path.join(os.tmpdir(), `sdr-test-video-${process.pid}`);
const file = (name: string) => path.join(dir, name);

const make = (out: string, codecArgs: string[]) => {
  const r = spawnSync(ffmpeg, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    ...codecArgs, out
  ]);
  if (r.status !== 0) throw new Error(r.stderr.toString());
};

/** "Fast start": the index (moov) comes before the media data (mdat). */
const isFastStart = async (f: string) => {
  const buf = await fs.readFile(f);
  return buf.indexOf("moov") < buf.indexOf("mdat");
};

describe("video processing (ffmpeg)", () => {
  beforeAll(async () => {
    await fs.mkdir(dir, { recursive: true });
    make(file("h264.mp4"), ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]); // index at the end (no faststart)
    make(file("vp9.webm"), ["-c:v", "libvpx-vp9", "-b:v", "200k", "-c:a", "libopus"]);
    await fs.writeFile(file("not-a-video.mp4"), "hello");
  });
  afterAll(() => fs.rm(dir, { recursive: true, force: true }));

  it("probe reads format, duration, codecs and size", async () => {
    const p = await probe(file("h264.mp4"));
    expect(p.formatName).toMatch(/mp4/);
    expect(p.durationSec).toBeGreaterThan(1.5);
    expect(p.video).toMatchObject({ codec: "h264", pixFmt: "yuv420p", width: 320, height: 240 });
    expect(p.audio?.codec).toBe("aac");
  });

  it("an H.264/AAC MP4 is only remuxed (fast, no quality loss) and gets fast start", async () => {
    const p = await probe(file("h264.mp4"));
    expect(canRemux(p)).toBe(true);
    expect(await isFastStart(file("h264.mp4"))).toBe(false);
    await remuxFastStart(file("h264.mp4"), file("remuxed.mp4"));
    expect(await isFastStart(file("remuxed.mp4"))).toBe(true);
  });

  it("a WebM (VP9/Opus) needs converting and becomes a browser-safe H.264/AAC MP4", async () => {
    const p = await probe(file("vp9.webm"));
    expect(canRemux(p)).toBe(false);
    await transcodeToMp4(file("vp9.webm"), file("converted.mp4"));
    const out = await probe(file("converted.mp4"));
    expect(out.video).toMatchObject({ codec: "h264", pixFmt: "yuv420p" });
    expect(out.audio?.codec).toBe("aac");
    expect(canRemux(out)).toBe(true);
    expect(await isFastStart(file("converted.mp4"))).toBe(true);
  });

  it("makes a JPG thumbnail", async () => {
    await extractThumbnail(file("h264.mp4"), file("thumb.jpg"), 1);
    const jpg = await fs.readFile(file("thumb.jpg"));
    expect(jpg.subarray(0, 2).toString("hex")).toBe("ffd8"); // JPEG signature
  });

  it("a file that is not a video fails permanently (no pointless retries)", async () => {
    await expect(probe(file("not-a-video.mp4"))).rejects.toBeInstanceOf(PermanentVideoError);
  });
});

describe("1080p limit", () => {
  const dir2 = path.join(os.tmpdir(), `sdr-test-1080-${process.pid}`);
  const at = (name: string) => path.join(dir2, name);
  const makeSized = (out: string, size: string) => {
    const r = spawnSync(ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=size=${size}:rate=25:duration=1`, "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", out]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
  };
  beforeAll(async () => {
    await fs.mkdir(dir2, { recursive: true });
    makeSized(at("1440p.mp4"), "2560x1440");
    makeSized(at("portrait-1080.mp4"), "1080x1920");
    makeSized(at("portrait-1440.mp4"), "1440x2560");
    makeSized(at("720p.mp4"), "1280x720");
  });
  afterAll(() => fs.rm(dir2, { recursive: true, force: true }));

  it("H.264 up to 1080p (landscape or portrait) is only remuxed", async () => {
    expect(canRemux(await probe(at("720p.mp4")))).toBe(true);
    expect(canRemux(await probe(at("portrait-1080.mp4")))).toBe(true);
  });

  it("a 1440p H.264 video is converted down to 1920x1080", async () => {
    expect(canRemux(await probe(at("1440p.mp4")))).toBe(false);
    await transcodeToMp4(at("1440p.mp4"), at("1440p-out.mp4"));
    expect((await probe(at("1440p-out.mp4"))).video).toMatchObject({ width: 1920, height: 1080 });
  });

  it("a big portrait video becomes 1080x1920, not squashed to 1080 tall", async () => {
    expect(canRemux(await probe(at("portrait-1440.mp4")))).toBe(false);
    await transcodeToMp4(at("portrait-1440.mp4"), at("portrait-out.mp4"));
    expect((await probe(at("portrait-out.mp4"))).video).toMatchObject({ width: 1080, height: 1920 });
  });

  it("small videos are never enlarged when converted", async () => {
    await transcodeToMp4(at("720p.mp4"), at("720p-out.mp4"));
    expect((await probe(at("720p-out.mp4"))).video).toMatchObject({ width: 1280, height: 720 });
  });
});
