import { Router } from "express";
import {
  createFlowHandler,
  deleteFlowHandler,
  demoFromFlowHandler,
  getFlowHandler,
  listFlowsHandler,
  restoreFlowHandler,
  updateFlowHandler
} from "../controllers/demo.controller";
import { validate, validateParams } from "../middlewares/schemaValidator";
import { idParamsSchema } from "../validators/common.validator";
import { createFlowSchema, demoFromFlowSchema, updateFlowSchema } from "../validators/demo.validator";

const router = Router();

router.get("/", listFlowsHandler);
router.post("/", validate(createFlowSchema), createFlowHandler);
router.get("/:id", validateParams(idParamsSchema), getFlowHandler);
router.patch("/:id", validateParams(idParamsSchema), validate(updateFlowSchema), updateFlowHandler);
router.delete("/:id", validateParams(idParamsSchema), deleteFlowHandler);
router.post("/:id/restore", validateParams(idParamsSchema), restoreFlowHandler);
router.post("/:id/demos", validateParams(idParamsSchema), validate(demoFromFlowSchema), demoFromFlowHandler);

export default router;
