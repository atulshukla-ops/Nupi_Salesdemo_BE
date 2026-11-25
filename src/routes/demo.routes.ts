import { Router } from "express";
import {
  createDemoHandler,
  deleteDemoHandler,
  demoSessionsHandler,
  liveTokenHandler,
  duplicateDemoHandler,
  getDemoHandler,
  listDemosHandler,
  restoreDemoHandler,
  saveDemoAsFlowHandler,
  updateDemoHandler
} from "../controllers/demo.controller";
import { validate, validateParams, validateQuery } from "../middlewares/schemaValidator";
import { idParamsSchema } from "../validators/common.validator";
import { createDemoSchema, listQuerySchema, saveAsFlowSchema, updateDemoSchema } from "../validators/demo.validator";

const router = Router();

router.get("/", validateQuery(listQuerySchema), listDemosHandler);
router.post("/", validate(createDemoSchema), createDemoHandler);
router.get("/:id", validateParams(idParamsSchema), getDemoHandler);
router.patch("/:id", validateParams(idParamsSchema), validate(updateDemoSchema), updateDemoHandler);
router.delete("/:id", validateParams(idParamsSchema), deleteDemoHandler);
router.post("/:id/restore", validateParams(idParamsSchema), restoreDemoHandler);
router.post("/:id/duplicate", validateParams(idParamsSchema), duplicateDemoHandler);
router.post("/:id/save-as-flow", validateParams(idParamsSchema), validate(saveAsFlowSchema), saveDemoAsFlowHandler);
router.post("/:id/live-token", validateParams(idParamsSchema), liveTokenHandler);
router.get("/:id/sessions", validateParams(idParamsSchema), demoSessionsHandler);

export default router;
