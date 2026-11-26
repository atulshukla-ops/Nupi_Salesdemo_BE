import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { PendingUpload } from "../constants/types";
import { Asset } from "../entities/asset.entity";
import { deckKeys, storage, versionPrefix } from "../storage";
import logger from "../utils/logger";
import { PermanentVideoError } from "../utils/ffmpeg";
import { officeToPdf, pdfToSlides, readDeckFormat } from "../utils/slides";

/**
 * Turns an uploaded deck into what viewers see:
 *  1. PPTX/PPT → PDF (LibreOffice); PDFs skip this step
 *  2. every page → a 1920 px wide JPEG slide, plus a thumbnail of slide 1
 *  3. store the slides, switch the asset to this version, mark it "ready"
 * Like videos, an older version stays in storage until no link to it can still be valid.
 */
export const processDeck = async (asset: Asset, pending: PendingUpload, version: number) => {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "sdr-deck-"));
  const started = Date.now();
  try {
    const original = path.join(work, path.basename(pending.objectKey));
    await storage().downloadToFile(pending.objectKey, original);

    // Trust the file's content, not its name: a renamed file must not slip through.
    const format = await readDeckFormat(original);
    if (!format) throw new PermanentVideoError("This file is not a PowerPoint (PPTX/PPT) or PDF file. Open it in PowerPoint and save it again, or upload a PDF.");
    const pdf = format === "pdf" ? original : await officeToPdf(original, work, format);
    const slides = await pdfToSlides(pdf, path.join(work, "slides"));

    const keys = deckKeys(asset.id, version);
    // A few at a time: fast on S3, gentle on the local disk.
    // If one upload fails, the others stop too, and the error is raised only after all have
    // stopped (so the temporary files are not deleted under a running upload).
    const queue = slides.files.map((file, i) => ({ file, key: keys.slide(i + 1) }));
    let failed = false;
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, async () => {
        for (let item = queue.shift(); item && !failed; item = queue.shift()) {
          try {
            await storage().uploadFromFile(item.file, item.key, "image/jpeg");
          } catch (e) {
            failed = true;
            throw e;
          }
        }
      })
    );
    const firstError = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    if (firstError) throw firstError.reason;
    await storage().uploadFromFile(slides.thumbnail, keys.thumbnail, "image/jpeg");

    // Re-read: the user may have cancelled or started another replacement while we were working.
    const current = await Asset.findOneBy({ id: asset.id });
    if (!current || current.pendingUpload?.version !== version || current.pendingUpload.state !== "processing") {
      await storage().deletePrefix(versionPrefix(asset.id, version));
      logger.info(`Deck ${asset.id} v${version} finished but is no longer wanted; discarded`);
      return { skipped: true };
    }

    Object.assign(current, {
      status: "ready",
      failureReason: null,
      version,
      playbackKey: keys.slidesPrefix,
      thumbnailKey: keys.thumbnail,
      originalFileName: pending.fileName,
      mimeType: pending.mimeType,
      sizeBytes: pending.sizeBytes,
      durationSec: null,
      width: slides.width,
      height: slides.height,
      slideCount: slides.count,
      pendingUpload: null,
      replacedAt: pending.purpose === "replace" ? new Date() : current.replacedAt
    });
    await current.save();
    logger.info(`Deck ${asset.id} v${version} ready: ${slides.count} slides ${slides.width}x${slides.height}, took ${((Date.now() - started) / 1000).toFixed(1)}s`);
    return { skipped: false, mode: "deck" };
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
};
