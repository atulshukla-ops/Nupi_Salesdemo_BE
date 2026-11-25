import { IsNull, LessThan, Not } from "typeorm";
import env from "../configs/env";
import { Asset } from "../entities/asset.entity";
import { Demo } from "../entities/demo.entity";
import { enqueueVideoProcessing } from "../jobs/boss";
import { assetPrefix, storage } from "../storage";
import { listMultipartUploads } from "../storage/localStorage.driver";
import logger from "../utils/logger";

const HOUR = 60 * 60 * 1000;

/**
 * Nightly housekeeping (also runnable on demand: npm run cleanup:now).
 *  - uploads left unfinished for UPLOAD_ABANDON_HOURS (24) are cancelled (a new video that never finished is removed)
 *  - files stuck in "processing" for PROCESSING_REQUEUE_MINUTES (60) are queued again (e.g. the worker was down)
 *  - Trash items older than TRASH_RETENTION_DAYS are deleted for good, including their files
 *  - (local storage) part folders that no upload refers to any more are removed
 */
export const runMaintenance = async () => {
  const now = Date.now();
  const ABANDONED_AFTER_MS = env.uploadAbandonHours * HOUR;
  const REQUEUE_PROCESSING_AFTER_MS = env.processingRequeueMinutes * 60 * 1000;
  const report = { abandonedUploads: 0, removedUnfinishedVideos: 0, requeued: 0, purgedAssets: 0, purgedDemos: 0, orphanPartFolders: 0 };

  const withUploads = await Asset.find({ where: { pendingUpload: Not(IsNull()) } });
  for (const asset of withUploads) {
    const pending = asset.pendingUpload!;
    const age = now - new Date(pending.startedAt).getTime();

    if (pending.state === "uploading" && age > ABANDONED_AFTER_MS) {
      await storage().abortMultipartUpload(pending.objectKey, pending.uploadId);
      report.abandonedUploads++;
      if (pending.purpose === "new" && asset.version === 0) {
        await storage().deletePrefix(assetPrefix(asset.id));
        await asset.remove();
        report.removedUnfinishedVideos++;
      } else {
        asset.pendingUpload = null;
        await asset.save();
      }
    } else if (pending.state === "processing" && age > REQUEUE_PROCESSING_AFTER_MS) {
      await enqueueVideoProcessing(asset.id, pending.version);
      report.requeued++;
    }
  }

  const cutoff = new Date(now - env.trashRetentionDays * 24 * HOUR);
  for (const asset of await Asset.find({ where: { deletedAt: LessThan(cutoff) } })) {
    await storage().deletePrefix(assetPrefix(asset.id));
    await asset.remove();
    report.purgedAssets++;
  }
  // Live sessions of a purged demo are removed with it (ON DELETE CASCADE).
  const oldDemos = await Demo.find({ where: { deletedAt: LessThan(cutoff) } });
  if (oldDemos.length) await Demo.remove(oldDemos);
  report.purgedDemos = oldDemos.length;

  if (storage().name === "local") {
    const referenced = new Set(
      (await Asset.find({ where: { pendingUpload: Not(IsNull()) } })).map((a) => a.pendingUpload!.uploadId)
    );
    // Only folders older than a day: a brand-new upload creates its folder just before it is recorded.
    for (const { uploadId, createdAt } of await listMultipartUploads()) {
      if (!referenced.has(uploadId) && now - createdAt.getTime() > ABANDONED_AFTER_MS) {
        await storage().abortMultipartUpload("", uploadId);
        report.orphanPartFolders++;
      }
    }
  }

  logger.info(`Maintenance done: ${JSON.stringify(report)}`);
  return report;
};
