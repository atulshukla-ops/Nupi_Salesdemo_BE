import { Router } from "express";
import { publicDemoHandler } from "../controllers/demo.controller";
import { validateParams } from "../middlewares/schemaValidator";
import { publicSlugParamsSchema } from "../validators/demo.validator";

// No team key: used by the client's viewer page. Exposes only what the waiting room shows.
const router = Router();

router.get("/demos/:slug", validateParams(publicSlugParamsSchema), publicDemoHandler);

export default router;
