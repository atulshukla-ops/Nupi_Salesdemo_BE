import { Router } from "express";
import {
  abortUploadHandler,
  completeUploadHandler,
  partUrlsHandler,
  startUploadHandler,
  uploadedPartsHandler
} from "../controllers/upload.controller";
import { validate, validateParams } from "../middlewares/schemaValidator";
import { idParamsSchema } from "../validators/common.validator";
import { completeUploadSchema, partUrlsSchema, startUploadSchema } from "../validators/upload.validator";

// The :id of an upload is the asset id (an asset has at most one upload in progress).
const router = Router();

router.post("/", validate(startUploadSchema), startUploadHandler);
router.post("/:id/part-urls", validateParams(idParamsSchema), validate(partUrlsSchema), partUrlsHandler);
router.get("/:id/parts", validateParams(idParamsSchema), uploadedPartsHandler);
router.post("/:id/complete", validateParams(idParamsSchema), validate(completeUploadSchema), completeUploadHandler);
router.delete("/:id", validateParams(idParamsSchema), abortUploadHandler);

export default router;
