import { Request, Response } from "express";
import {
  deleteAsset,
  findAssetUsage,
  findLiveAsset,
  listAssets,
  reorderAssets,
  restoreAsset,
  updateAsset
} from "../services/asset.service";
import { assetsWithUrls, assetWithUrls, getPlaybackUrl } from "../services/playback.service";
import asyncHandler from "../utils/asyncHandler";
import { presenterName } from "../utils/presenter";
import { successCallback } from "../utils/successResponse";

export const listAssetsHandler = asyncHandler(async (req: Request, res: Response) => {
  const assets = await listAssets(req.query.productId as string | undefined);
  successCallback(res, "success", "AssetList", "Assets loaded", await assetsWithUrls(assets));
});

export const getAssetHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "AssetGet", "Asset loaded", await assetWithUrls(await findLiveAsset(req.params.id)));
});

/** Signed link to play the video now (the console calls this when a video goes on air). */
export const playbackUrlHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "AssetPlaybackUrl", "Playback link ready", await getPlaybackUrl(req.params.id));
});

/** Lets the frontend warn "used in 3 demos" before the user confirms a delete. */
export const assetUsageHandler = asyncHandler(async (req: Request, res: Response) => {
  await findLiveAsset(req.params.id);
  successCallback(res, "success", "AssetUsage", "Usage loaded", await findAssetUsage(req.params.id));
});

export const updateAssetHandler = asyncHandler(async (req: Request, res: Response) => {
  const asset = await updateAsset(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "AssetUpdate", "Saved", await assetWithUrls(asset));
});

export const deleteAssetHandler = asyncHandler(async (req: Request, res: Response) => {
  const { asset, usedIn } = await deleteAsset(req.params.id, presenterName(req));
  successCallback(res, "success", "AssetDelete", "Moved to Trash", { asset: await assetWithUrls(asset), usedIn });
});

export const restoreAssetHandler = asyncHandler(async (req: Request, res: Response) => {
  const asset = await restoreAsset(req.params.id, presenterName(req));
  successCallback(res, "success", "AssetRestore", "Restored from Trash", await assetWithUrls(asset));
});

export const reorderAssetsHandler = asyncHandler(async (req: Request, res: Response) => {
  const assets = await reorderAssets(req.body.productId, req.body.ids, presenterName(req));
  successCallback(res, "success", "AssetReorder", "Order saved", await assetsWithUrls(assets));
});
