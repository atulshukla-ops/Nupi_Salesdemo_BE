import { Router } from "express";
import {
  assetUsageHandler,
  deleteAssetHandler,
  getAssetHandler,
  listAssetsHandler,
  playbackUrlHandler,
  slidesHandler,
  reorderAssetsHandler,
  restoreAssetHandler,
  updateAssetHandler
} from "../controllers/asset.controller";
import { startReplaceUploadHandler } from "../controllers/upload.controller";
import { validate, validateParams, validateQuery } from "../middlewares/schemaValidator";
import { listAssetsQuerySchema, reorderAssetsSchema, updateAssetSchema } from "../validators/asset.validator";
import { idParamsSchema } from "../validators/common.validator";
import { replaceUploadSchema } from "../validators/upload.validator";

// New assets are created through the upload flow (/api/uploads).
const router = Router();

router.get("/", validateQuery(listAssetsQuerySchema), listAssetsHandler);
router.post("/reorder", validate(reorderAssetsSchema), reorderAssetsHandler);
router.get("/:id", validateParams(idParamsSchema), getAssetHandler);
router.get("/:id/usage", validateParams(idParamsSchema), assetUsageHandler);
router.get("/:id/playback-url", validateParams(idParamsSchema), playbackUrlHandler);
router.get("/:id/slides", validateParams(idParamsSchema), slidesHandler);
router.patch("/:id", validateParams(idParamsSchema), validate(updateAssetSchema), updateAssetHandler);
router.delete("/:id", validateParams(idParamsSchema), deleteAssetHandler);
router.post("/:id/restore", validateParams(idParamsSchema), restoreAssetHandler);
router.post("/:id/replace-upload", validateParams(idParamsSchema), validate(replaceUploadSchema), startReplaceUploadHandler);

export default router;
