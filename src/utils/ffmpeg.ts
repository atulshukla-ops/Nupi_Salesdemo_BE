import { spawn } from "child_process";

/**
 * ffmpeg / ffprobe runner. Uses FFMPEG_PATH / FFPROBE_PATH when set (the Docker image's system
 * ffmpeg in production), otherwise the binaries bundled by npm (local development, nothing to install).
 * The npm binaries are optional dependencies (~400 MB) and are loaded only when needed, so the
 * Docker image can leave them out.
 */
const ffmpegPath = (): string => process.env.FFMPEG_PATH || (require("ffmpeg-static") as string);
const ffprobePath = (): string => process.env.FFPROBE_PATH || (require("ffprobe-static") as { path: string }).path;

/** A video problem that retrying will not fix (not a video, too long, …). */
export class PermanentVideoError extends Error {}

const run = (bin: string, args: string[], timeoutMs: number) =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000))); // keep the tail for error messages
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) return resolve(stdout);
      const why = signal ? `killed (${signal}) after ${Math.round(timeoutMs / 1000)}s` : `exit code ${code}`;
      reject(new Error(`${bin.split(/[\\/]/).pop()} failed: ${why}: ${stderr.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });

export interface ProbeResult {
  formatName: string;
  durationSec: number;
  video?: { codec: string; pixFmt: string; width: number; height: number };
  audio?: { codec: string };
}

export const probe = async (file: string): Promise<ProbeResult> => {
  let raw: string;
  try {
    raw = await run(ffprobePath(), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], 60_000);
  } catch {
    throw new PermanentVideoError("This file is not a playable video");
  }
  const json = JSON.parse(raw) as {
    format?: { format_name?: string; duration?: string };
    streams?: { codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[];
  };
  // Ignore cover-art "video" streams embedded in some files.
  const v = json.streams?.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const a = json.streams?.find((s) => s.codec_type === "audio");
  return {
    formatName: json.format?.format_name ?? "",
    durationSec: Number(json.format?.duration ?? v?.duration ?? 0) || 0,
    video: v ? { codec: v.codec_name ?? "", pixFmt: v.pix_fmt ?? "", width: v.width ?? 0, height: v.height ?? 0 } : undefined,
    audio: a ? { codec: a.codec_name ?? "" } : undefined
  };
};

/**
 * Browsers play H.264 (8-bit 4:2:0) + AAC in MP4 everywhere. Such files only need "fast start"
 * (index moved to the front, so playback begins before the whole file has downloaded).
 */
export const canRemux = (p: ProbeResult) =>
  /mp4|mov/.test(p.formatName) &&
  p.video?.codec === "h264" &&
  ["yuv420p", "yuvj420p"].includes(p.video.pixFmt) &&
  (!p.audio || p.audio.codec === "aac");

/** Same streams, no re-encoding, index moved to the front. Takes seconds. */
export const remuxFastStart = (input: string, output: string) =>
  run(ffmpegPath(), ["-y", "-v", "error", "-i", input, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-movflags", "+faststart", output], 10 * 60_000);

/** Re-encode to H.264/AAC, at most 1080p tall, fast start. Takes minutes for long videos. */
export const transcodeToMp4 = (input: string, output: string) =>
  run(
    ffmpegPath(),
    [
      "-y", "-v", "error", "-i", input,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-vf", "scale=-2:'min(1080,ih)'",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      output
    ],
    3 * 60 * 60_000
  );

/** One frame, 640 px wide, as JPG. */
export const extractThumbnail = (input: string, output: string, atSec: number) =>
  run(ffmpegPath(), ["-y", "-v", "error", "-ss", atSec.toFixed(2), "-i", input, "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "3", output], 60_000);
