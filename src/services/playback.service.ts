import env from "../configs/env";
import { Asset } from "../entities/asset.entity";
import { deckKeys, storage } from "../storage";
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
  if (asset.kind === "deck") throw new AppError(409, "This is a deck: use its slides");
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

/**
 * Signed links to every slide of a deck, in order (for the Library preview and, later, presenting).
 * Links are stable within 30-minute windows so browsers can cache slides they already loaded.
 */
export const getSlides = async (assetId: string) => {
  const asset = await findLiveAsset(assetId);
  if (asset.kind !== "deck") throw new AppError(409, "This is a video, not a deck");
  if (asset.status !== "ready" || !asset.slideCount || asset.version < 1) {
    throw new AppError(409, asset.status === "failed" ? "This deck failed to convert" : "This deck is not ready yet");
  }
  const keys = deckKeys(asset.id, asset.version);
  const signed = await Promise.all(
    Array.from({ length: asset.slideCount }, (_, i) => storage().presignGet(keys.slide(i + 1), env.playbackUrlTtlSec, 30 * 60))
  );
  return {
    assetId: asset.id,
    version: asset.version,
    slideCount: asset.slideCount,
    width: asset.width,
    height: asset.height,
    expiresAt: signed[0].expiresAt,
    slides: signed.map((s) => s.url)
  };
};
