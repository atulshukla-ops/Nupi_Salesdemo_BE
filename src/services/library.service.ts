import { transcriptionEnabled } from "./fireflies.client";
import { IsNull, Not } from "typeorm";
import env from "../configs/env";
import { Asset } from "../entities/asset.entity";
import { Demo } from "../entities/demo.entity";
import { Product } from "../entities/product.entity";
import { addDays } from "../utils/dates";
import { listAssets } from "./asset.service";
import { flowToJSON, listFlows } from "./demo.service";
import { assetsWithUrls, assetWithUrls } from "./playback.service";
import { listProducts, productToJSON } from "./product.service";
import { getSettings } from "./settings.service";

/** Everything the presenter app needs on load, in one call (replaces the frontend's IndexedDB reads). */
export const getBootstrap = async () => {
  const [settings, products, assets, flows] = await Promise.all([getSettings(), listProducts(), listAssets(), listFlows()]);
  return {
    settings,
    products: products.map(productToJSON),
    assets: await assetsWithUrls(assets),
    flows: flows.map(flowToJSON),
    /** Upload limits, so the browser checks the same numbers as the server. */
    limits: { videoBytes: env.maxUploadBytes, deckBytes: env.maxDeckBytes },
    /** What this server has switched on. Transcription needs a Fireflies API key. */
    features: { transcription: transcriptionEnabled() }
  };
};

/** Items that can still be restored, with the date they will be removed for good. */
export const getTrash = async () => {
  const purgeAt = (d: Date | null) => (d ? addDays(d, env.trashRetentionDays) : null);
  const [products, assets, demos] = await Promise.all([
    Product.find({ where: { archivedAt: Not(IsNull()) }, order: { archivedAt: "DESC" } }),
    Asset.find({ where: { deletedAt: Not(IsNull()) }, order: { deletedAt: "DESC" } }),
    Demo.find({ where: { deletedAt: Not(IsNull()) }, order: { deletedAt: "DESC" } })
  ]);
  return {
    retentionDays: env.trashRetentionDays,
    // Archived products (deleted tabs) are kept until someone deletes them for good; never purged automatically.
    products: await Promise.all(products.map(async (p) => ({ ...productToJSON(p), videoCount: await Asset.count({ where: { productId: p.id } }) }))),
    assets: await Promise.all(assets.map(async (a) => ({ ...(await assetWithUrls(a)), deletedAt: a.deletedAt, purgeAt: purgeAt(a.deletedAt) }))),
    demos: demos
      .filter((d) => !d.isTemplate)
      .map((d) => ({ id: d.id, name: d.name, clientName: d.clientName, date: d.demoDate, deletedAt: d.deletedAt, purgeAt: purgeAt(d.deletedAt) })),
    flows: demos
      .filter((d) => d.isTemplate)
      .map((d) => ({ id: d.id, name: d.name, audience: d.audience, deletedAt: d.deletedAt, purgeAt: purgeAt(d.deletedAt) }))
  };
};
