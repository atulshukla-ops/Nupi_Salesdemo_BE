import { Router } from "express";
import { bootstrapHandler, getSettingsHandler, trashHandler, updateSettingsHandler } from "../controllers/library.controller";
import { validate } from "../middlewares/schemaValidator";
import { updateSettingsSchema } from "../validators/settings.validator";

const router = Router();

router.get("/bootstrap", bootstrapHandler);
router.get("/trash", trashHandler);
router.get("/settings", getSettingsHandler);
router.put("/settings", validate(updateSettingsSchema), updateSettingsHandler);

export default router;
