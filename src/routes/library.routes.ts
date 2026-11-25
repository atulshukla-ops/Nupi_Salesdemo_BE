import { Router } from "express";
import { bootstrapHandler, getSettingsHandler, purgeTrashHandler, trashHandler, updateSettingsHandler } from "../controllers/library.controller";
import { validate, validateParams } from "../middlewares/schemaValidator";
import { trashParamsSchema } from "../validators/common.validator";
import { updateSettingsSchema } from "../validators/settings.validator";

const router = Router();

router.get("/bootstrap", bootstrapHandler);
router.get("/trash", trashHandler);
router.delete("/trash/:kind/:id", validateParams(trashParamsSchema), purgeTrashHandler);
router.get("/settings", getSettingsHandler);
router.put("/settings", validate(updateSettingsSchema), updateSettingsHandler);

export default router;
