import { Router } from "express";
import {
  archiveProductHandler,
  createProductHandler,
  listProductsHandler,
  reorderProductsHandler,
  restoreProductHandler,
  updateProductHandler
} from "../controllers/product.controller";
import { validate, validateParams } from "../middlewares/schemaValidator";
import { idParamsSchema } from "../validators/common.validator";
import { createProductSchema, reorderProductsSchema, updateProductSchema } from "../validators/product.validator";

const router = Router();

router.get("/", listProductsHandler);
router.post("/", validate(createProductSchema), createProductHandler);
router.post("/reorder", validate(reorderProductsSchema), reorderProductsHandler);
router.patch("/:id", validateParams(idParamsSchema), validate(updateProductSchema), updateProductHandler);
router.delete("/:id", validateParams(idParamsSchema), archiveProductHandler);
router.post("/:id/restore", validateParams(idParamsSchema), restoreProductHandler);

export default router;
