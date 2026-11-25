import env from "../configs/env";
import { Asset } from "../entities/asset.entity";
import { storage } from "../storage";
import AppError from "../utils/appError";
import { assetToJSON, findLiveAsset } from "./asset.service";

const HOUR = 60 * 60;
/** Thumbnails: valid ≥ 24 h, URL stable within 6-hour windows so browsers cache the images. */
const THUMB_TTL_SEC = 24 * HOUR;
const THUMB_ALIGN_SEC = 6 * HOUR;

const thumbnailUrl = async (a: Asset) =>
  a.thumbnailKey ? (await storage().presignGet(a.thumbnailKey, THUMB_TTL_SEC, THUMB_ALIGN_SEC)).url : null;

/** assetToJSON + a signed thumbnail URL (used by every endpoint that returns assets). */
export const assetWithUrls = async (a: Asset) => ({ ...assetToJSON(a), thumbnailUrl: await thumbnailUrl(a) });

export const assetsWithUrls = (assets: Asset[]) => Promise.all(assets.map(assetWithUrls));

/**
 * Signed link to the playable file, for the console to put on air (and pass to viewers).
 * While a replacement is processing, this still returns the current (old) file.
 */
export const getPlaybackUrl = async (assetId: string) => {
  const asset = await findLiveAsset(assetId);
  if (asset.status !== "ready" || !asset.playbackKey || asset.version < 1) {
    throw new AppError(409, asset.status === "failed" ? "This video failed to process" : "This video is not ready yet");
  }
  const { url, expiresAt } = await storage().presignGet(asset.playbackKey, env.playbackUrlTtlSec);
  return {
    assetId: asset.id,
    version: asset.version,
    url,
    expiresAt,
    thumbnailUrl: await thumbnailUrl(asset),
    durationSec: asset.durationSec,
    width: asset.width,
    height: asset.height
  };
};
