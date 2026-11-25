import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Asset } from "../entities/asset.entity";
import { assetKeys, storage, versionPrefix } from "../storage";
import { canRemux, extractThumbnail, PermanentVideoError, probe, remuxFastStart, transcodeToMp4 } from "../utils/ffmpeg";
import logger from "../utils/logger";

const MAX_DURATION_SEC = 3 * 60 * 60;

/** Marks the upload as failed. A brand-new video becomes "failed"; a replacement leaves the old file playing. */
export const markProcessingFailed = async (assetId: string, version: number, reason: string) => {
  const asset = await Asset.findOneBy({ id: assetId });
  const pending = asset?.pendingUpload;
  if (!asset || !pending || pending.version !== version) return;
  asset.pendingUpload = { ...pending, state: "failed", failureReason: reason };
  if (pending.purpose === "new") {
    asset.status = "failed";
    asset.failureReason = reason;
  }
  await asset.save();
  logger.warn(`Video ${assetId} v${version} failed: ${reason}`);
};

/**
 * Turns an uploaded original into what viewers play:
 *  1. check it really is a video (ffprobe)
 *  2. H.264/AAC MP4 → fast-start remux (seconds); anything else → convert to 1080p H.264/AAC (minutes)
 *  3. thumbnail at ~2 s
 *  4. store play.mp4 + thumb.jpg, switch the asset to this version, mark it "ready"
 */
export const processVideo = async (assetId: string, version: number) => {
  const asset = await Asset.findOneBy({ id: assetId });
  const pending = asset?.pendingUpload;
  // The job is stale if the upload was cancelled, replaced again, or already processed.
  if (!asset || asset.deletedAt || !pending || pending.version !== version || pending.state !== "processing") {
    logger.info(`Skipping video job ${assetId} v${version}: nothing to process`);
    return { skipped: true };
  }

  const keys = assetKeys(asset.id, version, path.extname(pending.objectKey).slice(1));
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "sdr-video-"));
  const original = path.join(work, path.basename(pending.objectKey));
  const play = path.join(work, "play.mp4");
  const thumb = path.join(work, "thumb.jpg");
  const started = Date.now();

  try {
    await storage().downloadToFile(pending.objectKey, original);

    const input = await probe(original);
    if (!input.video) throw new PermanentVideoError("The file has no video track");
    if (input.durationSec <= 0) throw new PermanentVideoError("Could not read the video's length");
    if (input.durationSec > MAX_DURATION_SEC) throw new PermanentVideoError("Videos longer than 3 hours are not supported");

    const mode = canRemux(input) ? "remux" : "transcode";
    if (mode === "remux") await remuxFastStart(original, play);
    else await transcodeToMp4(original, play);

    const output = await probe(play);
    await extractThumbnail(play, thumb, Math.min(2, output.durationSec / 3));

    await storage().uploadFromFile(play, keys.playback, "video/mp4");
    await storage().uploadFromFile(thumb, keys.thumbnail, "image/jpeg");

    // Re-read: the user may have cancelled or started another replacement while we were working.
    const current = await Asset.findOneBy({ id: assetId });
    if (!current || current.pendingUpload?.version !== version || current.pendingUpload.state !== "processing") {
      await storage().deletePrefix(versionPrefix(assetId, version));
      logger.info(`Video ${assetId} v${version} finished but is no longer wanted; discarded`);
      return { skipped: true };
    }

    Object.assign(current, {
      status: "ready",
      failureReason: null,
      version,
      playbackKey: keys.playback,
      thumbnailKey: keys.thumbnail,
      originalFileName: pending.fileName,
      mimeType: pending.mimeType,
      sizeBytes: pending.sizeBytes,
      durationSec: Math.round(output.durationSec * 100) / 100,
      width: output.video?.width ?? null,
      height: output.video?.height ?? null,
      pendingUpload: null,
      replacedAt: pending.purpose === "replace" ? new Date() : current.replacedAt
    });
    await current.save();

    // Older versions are NOT deleted here: a demo may be playing one right now through a signed link
    // handed out earlier. The nightly maintenance removes them once every such link has expired.

    logger.info(
      `Video ${assetId} v${version} ready: ${mode}, ${output.durationSec.toFixed(1)}s, ` +
        `${output.video?.width}x${output.video?.height}, took ${((Date.now() - started) / 1000).toFixed(1)}s`
    );
    return { skipped: false, mode };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
};
