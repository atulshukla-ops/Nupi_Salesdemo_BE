import { FindOptionsWhere, IsNull, Not } from "typeorm";
import AppDataSource from "../configs/database";
import { Asset } from "../entities/asset.entity";
import { Demo } from "../entities/demo.entity";
import { Product } from "../entities/product.entity";
import AppError from "../utils/appError";
import { findActiveProduct } from "./product.service";

export const assetToJSON = (a: Asset) => ({
  id: a.id,
  productId: a.productId,
  kind: a.kind,
  title: a.title,
  description: a.description,
  notes: a.notes,
  status: a.status,
  failureReason: a.failureReason,
  /** True when the asset can be cued and played in a demo. */
  playable: a.status === "ready" && a.version > 0,
  version: a.version,
  durationSec: a.durationSec,
  width: a.width,
  height: a.height,
  sizeBytes: a.sizeBytes,
  originalFileName: a.originalFileName,
  mimeType: a.mimeType,
  sortOrder: a.sortOrder,
  /** Upload in progress (new file or replacement), without storage internals. */
  upload: a.pendingUpload
    ? {
        purpose: a.pendingUpload.purpose,
        state: a.pendingUpload.state,
        fileName: a.pendingUpload.fileName,
        sizeBytes: a.pendingUpload.sizeBytes,
        partSize: a.pendingUpload.partSize,
        partCount: a.pendingUpload.partCount,
        startedAt: a.pendingUpload.startedAt,
        failureReason: a.pendingUpload.failureReason ?? null
      }
    : null,
  createdBy: a.createdBy,
  updatedBy: a.updatedBy,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt,
  replacedAt: a.replacedAt
});

export const listAssets = (productId?: string) => {
  const where: FindOptionsWhere<Asset> = { deletedAt: IsNull() };
  if (productId) where.productId = productId;
  return Asset.find({ where, order: { sortOrder: "ASC", createdAt: "ASC" } });
};

export const findLiveAsset = async (id: string) => {
  const asset = await Asset.findOneBy({ id, deletedAt: IsNull() });
  if (!asset) throw new AppError(404, "Asset not found");
  return asset;
};

export const nextAssetSortOrder = async (productId: string) => {
  const row = await Asset.createQueryBuilder("a")
    .select("COALESCE(MAX(a.sortOrder), -1)", "max")
    .where("a.productId = :productId", { productId })
    .andWhere("a.deletedAt IS NULL")
    .getRawOne<{ max: number }>();
  return Number(row?.max ?? -1) + 1;
};

/** Where an asset is referenced: client demos and Standard Flows that are not deleted. */
export const findAssetUsage = async (assetId: string) => {
  const rows = await Demo.createQueryBuilder("d")
    .select(["d.id", "d.name", "d.clientName", "d.isTemplate"])
    .where("d.deletedAt IS NULL")
    .andWhere("d.runOfShow @> CAST(:pattern AS jsonb)", { pattern: JSON.stringify([{ items: [{ assetId }] }]) })
    .orderBy("d.updatedAt", "DESC")
    .getMany();
  const demos = rows.filter((d) => !d.isTemplate);
  const flows = rows.filter((d) => d.isTemplate);
  return {
    demos: demos.length,
    flows: flows.length,
    // A few names so the warning can say *where* it is used.
    examples: rows.slice(0, 5).map((d) => ({
      id: d.id,
      type: d.isTemplate ? "flow" : "demo",
      name: d.isTemplate ? d.name : [d.clientName, d.name].filter(Boolean).join(" · ")
    }))
  };
};

export const updateAsset = async (
  id: string,
  patch: Partial<{ title: string; description: string; notes: string; productId: string }>,
  by: string | null
) => {
  const asset = await findLiveAsset(id);
  if (patch.productId && patch.productId !== asset.productId) {
    await findActiveProduct(patch.productId);
    asset.sortOrder = await nextAssetSortOrder(patch.productId);
  }
  Object.assign(asset, patch, { updatedBy: by });
  return asset.save();
};

/** Moves the asset to Trash. Demos that reference it simply skip it until it is restored. */
export const deleteAsset = async (id: string, by: string | null) => {
  const asset = await findLiveAsset(id);
  const usedIn = await findAssetUsage(id);
  asset.deletedAt = new Date();
  asset.updatedBy = by;
  await asset.save();
  return { asset, usedIn };
};

export const restoreAsset = async (id: string, by: string | null) => {
  const asset = await Asset.findOneBy({ id, deletedAt: Not(IsNull()) });
  if (!asset) throw new AppError(404, "Deleted asset not found");
  const product = await Product.findOneBy({ id: asset.productId });
  if (!product || product.archivedAt) throw new AppError(409, "Its product is archived. Restore the product first.");
  asset.deletedAt = null;
  asset.sortOrder = await nextAssetSortOrder(asset.productId);
  asset.updatedBy = by;
  return asset.save();
};

/** Saves a complete new order for one product. The list must contain each of its assets exactly once. */
export const reorderAssets = async (productId: string, ids: string[], by: string | null) => {
  await findActiveProduct(productId);
  return AppDataSource.transaction(async (manager) => {
    const live = await manager.find(Asset, { where: { productId, deletedAt: IsNull() }, select: { id: true } });
    const liveIds = new Set(live.map((a) => a.id));
    if (ids.length !== liveIds.size || ids.some((id) => !liveIds.has(id))) {
      throw new AppError(422, "ids must list every asset of this product exactly once");
    }
    for (const [index, id] of ids.entries()) {
      await manager.update(Asset, { id }, { sortOrder: index, updatedBy: by });
    }
    return manager.find(Asset, { where: { productId, deletedAt: IsNull() }, order: { sortOrder: "ASC" } });
  });
};
