import path from "path";
import env from "../configs/env";
import { PendingUpload } from "../constants/types";
import { Asset } from "../entities/asset.entity";
import { enqueueVideoProcessing } from "../jobs/boss";
import { assetKeys, assetPrefix, storage } from "../storage";
import AppError from "../utils/appError";
import logger from "../utils/logger";
import { FILE_TYPES, kindForMime } from "../validators/upload.validator";
import { assetToJSON, findLiveAsset, nextAssetSortOrder } from "./asset.service";
import { assetWithUrls } from "./playback.service";
import { findActiveProduct } from "./product.service";

/** Signed part URLs stay valid for an hour; the browser simply asks again for later parts. */
const PART_URL_TTL_SEC = 60 * 60;

interface FileInfo {
  fileName: string;
  sizeBytes: number;
  mimeType: string;
}

const extensionFor = ({ fileName, mimeType }: FileInfo) => {
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const allowed = FILE_TYPES[mimeType];
  return allowed.includes(ext) ? ext : allowed[0];
};

/** "rewards-dashboard_v2.mp4" -> "rewards dashboard v2" */
const titleFromFileName = (fileName: string, kind: "video" | "deck") =>
  path.parse(fileName).name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || (kind === "deck" ? "Untitled deck" : "Untitled video");

const requirePending = (asset: Asset, states: PendingUpload["state"][] = ["uploading"]) => {
  const pending = asset.pendingUpload;
  if (!pending || !states.includes(pending.state)) {
    throw new AppError(409, "This asset has no upload in progress");
  }
  return pending;
};

/** What the browser needs to send (or resume sending) the file. */
const uploadSession = (asset: Asset) => {
  const pending = asset.pendingUpload!;
  return {
    assetId: asset.id,
    purpose: pending.purpose,
    partSize: pending.partSize,
    partCount: pending.partCount,
    sizeBytes: pending.sizeBytes,
    asset: assetToJSON(asset)
  };
};

/** Opens a multipart upload in storage and records it on the asset row. */
const beginPendingUpload = async (asset: Asset, purpose: PendingUpload["purpose"], file: FileInfo) => {
  const version = asset.version + 1;
  const objectKey = assetKeys(asset.id, version, extensionFor(file)).original;
  const { uploadId } = await storage().createMultipartUpload(objectKey, file.mimeType);
  asset.pendingUpload = {
    purpose,
    state: "uploading",
    uploadId,
    objectKey,
    version,
    fileName: file.fileName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    partSize: env.uploadPartBytes,
    partCount: Math.max(1, Math.ceil(file.sizeBytes / env.uploadPartBytes)),
    startedAt: new Date().toISOString()
  };
  return asset.save();
};

/** Step 1 (new video): creates the asset in "uploading" state and opens the upload. */
export const startUpload = async (
  input: FileInfo & { productId: string; title?: string; description: string; notes: string },
  by: string | null
) => {
  await findActiveProduct(input.productId);
  const asset = await Asset.create({
    productId: input.productId,
    kind: kindForMime(input.mimeType),
    title: input.title || titleFromFileName(input.fileName, kindForMime(input.mimeType)),
    description: input.description,
    notes: input.notes,
    status: "uploading",
    version: 0,
    sortOrder: await nextAssetSortOrder(input.productId),
    createdBy: by,
    updatedBy: by
  }).save();
  try {
    return uploadSession(await beginPendingUpload(asset, "new", input));
  } catch (error) {
    await asset.remove(); // nothing was uploaded yet, so leave no trace
    throw error;
  }
};

/**
 * Replacing the file of an existing video. The current file keeps playing in every demo until the
 * new one has been processed. Also used to retry a new video whose first upload failed.
 */
export const startReplaceUpload = async (assetId: string, file: FileInfo, by: string | null) => {
  const asset = await findLiveAsset(assetId);
  if (kindForMime(file.mimeType) !== asset.kind) {
    throw new AppError(422, asset.kind === "deck" ? "This is a deck: replace it with a PPTX, PPT or PDF file" : "This is a video: replace it with a video file");
  }
  const previous = asset.pendingUpload;
  if (previous?.state === "processing") {
    throw new AppError(409, "The previous file is still being processed. Try again when it is ready.");
  }
  if (previous?.state === "uploading") {
    await storage().abortMultipartUpload(previous.objectKey, previous.uploadId); // a stalled upload is replaced
  }
  const purpose = asset.version > 0 ? "replace" : "new";
  if (purpose === "new") {
    asset.status = "uploading";
    asset.failureReason = null;
  }
  asset.updatedBy = by;
  return uploadSession(await beginPendingUpload(asset, purpose, file));
};

/** Step 2: signed URLs for the parts the browser is about to send. */
export const getPartUrls = async (assetId: string, partNumbers: number[]) => {
  const asset = await findLiveAsset(assetId);
  const pending = requirePending(asset);
  const outOfRange = partNumbers.filter((n) => n > pending.partCount);
  if (outOfRange.length) throw new AppError(422, `This upload only has ${pending.partCount} parts`);
  const expiresAt = new Date(Date.now() + PART_URL_TTL_SEC * 1000).toISOString();
  const parts = await Promise.all(
    partNumbers.map(async (partNumber) => ({
      partNumber,
      url: await storage().presignUploadPart(pending.objectKey, pending.uploadId, partNumber, PART_URL_TTL_SEC),
      expiresAt
    }))
  );
  return { parts };
};

/** Resume: which parts storage already has, so only the missing ones are sent again. */
export const getUploadedParts = async (assetId: string) => {
  const asset = await findLiveAsset(assetId);
  const pending = requirePending(asset);
  const parts = await storage().listParts(pending.objectKey, pending.uploadId);
  const have = new Set(parts.map((p) => p.partNumber));
  const missing = Array.from({ length: pending.partCount }, (_, i) => i + 1).filter((n) => !have.has(n));
  return { ...uploadSession(asset), parts, missing };
};

/** Step 3: stitches the parts together, checks the size and hands the file over for processing. */
export const completeUpload = async (assetId: string, parts: { partNumber: number; etag: string }[], by: string | null) => {
  const asset = await findLiveAsset(assetId);
  // Already finished (the browser retried because the first answer got lost): same result again.
  if (asset.pendingUpload?.state === "processing") return assetWithUrls(asset);
  const pending = requirePending(asset);
  const numbers = new Set(parts.map((p) => p.partNumber));
  if (numbers.size !== pending.partCount || parts.some((p) => p.partNumber > pending.partCount)) {
    throw new AppError(422, `All ${pending.partCount} parts must be listed to finish the upload`);
  }

  await storage().completeMultipartUpload(pending.objectKey, pending.uploadId, parts);

  const stored = await storage().headObject(pending.objectKey);
  if (!stored || stored.size !== pending.sizeBytes) {
    const reason = `The uploaded file is ${stored?.size ?? 0} bytes but ${pending.sizeBytes} were expected. Please upload it again.`;
    asset.pendingUpload = { ...pending, state: "failed", failureReason: reason };
    if (pending.purpose === "new") {
      asset.status = "failed";
      asset.failureReason = reason;
    }
    await asset.save();
    throw new AppError(422, reason);
  }

  asset.pendingUpload = { ...pending, state: "processing" };
  if (pending.purpose === "new") asset.status = "processing";
  asset.updatedBy = by;
  await asset.save();
  logger.info(`Upload complete for asset ${asset.id} (${pending.sizeBytes} bytes, ${pending.partCount} parts)`);
  try {
    await enqueueVideoProcessing(asset.id, pending.version);
  } catch (error) {
    // The file is safely stored; the nightly maintenance re-queues anything stuck in "processing".
    logger.error(`Could not queue processing for asset ${asset.id}: ${error instanceof Error ? error.message : error}`);
  }
  return assetWithUrls(asset);
};

/** Cancel. A brand-new video that never finished uploading is removed entirely. */
export const abortUpload = async (assetId: string, by: string | null) => {
  const asset = await findLiveAsset(assetId);
  const pending = requirePending(asset, ["uploading", "failed"]);
  await storage().abortMultipartUpload(pending.objectKey, pending.uploadId);

  if (pending.purpose === "new" && asset.version === 0) {
    await storage().deletePrefix(assetPrefix(asset.id));
    await asset.remove();
    return { removed: true, asset: null };
  }
  asset.pendingUpload = null;
  asset.updatedBy = by;
  await asset.save();
  return { removed: false, asset: await assetWithUrls(asset) };
};
