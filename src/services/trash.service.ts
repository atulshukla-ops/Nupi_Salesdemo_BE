import { IsNull, Not } from "typeorm";
import AppDataSource from "../configs/database";
import { Asset } from "../entities/asset.entity";
import { Demo } from "../entities/demo.entity";
import { Product } from "../entities/product.entity";
import { assetPrefix, storage } from "../storage";
import AppError from "../utils/appError";
import logger from "../utils/logger";

/**
 * Permanent deletes ("Delete forever" in Trash). Only items that are already in the Trash can be
 * deleted this way, so nothing in use is ever removed by a single click.
 */
export type TrashKind = "assets" | "demos" | "flows" | "products";

/** Removes a video for good: stops an unfinished upload, deletes every version's files, then the row. */
export const purgeAsset = async (asset: Asset) => {
  const pending = asset.pendingUpload;
  if (pending?.state === "uploading") await storage().abortMultipartUpload(pending.objectKey, pending.uploadId);
  // Files first: if this fails the row stays, so the delete can simply be tried again.
  await storage().deletePrefix(assetPrefix(asset.id));
  await asset.remove();
};

export const purgeTrashItem = async (kind: TrashKind, id: string) => {
  if (kind === "assets") {
    const asset = await Asset.findOneBy({ id, deletedAt: Not(IsNull()) });
    if (!asset) throw new AppError(404, "This video is not in the Trash");
    await purgeAsset(asset);
    logger.info(`Video ${id} deleted for good`);
    return { kind, id, removedVideos: 1 };
  }

  if (kind === "demos" || kind === "flows") {
    const isTemplate = kind === "flows";
    const row = await Demo.findOneBy({ id, isTemplate, deletedAt: Not(IsNull()) });
    if (!row) throw new AppError(404, isTemplate ? "This Standard Flow is not in the Trash" : "This demo is not in the Trash");
    // Its live sessions go with it (ON DELETE CASCADE); demos made from a flow keep working (FlowId is set to null).
    await row.remove();
    logger.info(`${isTemplate ? "Flow" : "Demo"} ${id} deleted for good`);
    return { kind, id, removedVideos: 0 };
  }

  // A deleted (archived) tab: the tab and every video in it, including ones already in the Trash.
  const product = await Product.findOneBy({ id, archivedAt: Not(IsNull()) });
  if (!product) throw new AppError(404, "This tab is not in the Trash");
  const assets = await Asset.findBy({ productId: id });
  for (const asset of assets) await purgeAsset(asset);
  await AppDataSource.transaction(async (m) => {
    // Re-check inside the transaction: a video added meanwhile would block the delete (foreign key).
    if (await m.count(Asset, { where: { productId: id } })) throw new AppError(409, "A video was just added to this tab. Try again.");
    await m.remove(product);
  });
  logger.info(`Tab ${product.name} (${id}) deleted for good with ${assets.length} video(s)`);
  return { kind, id, removedVideos: assets.length };
};
