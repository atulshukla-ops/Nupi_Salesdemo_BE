import { Request, Response } from "express";
import {
  archiveProduct,
  createProduct,
  listProducts,
  productToJSON,
  reorderProducts,
  restoreProduct,
  updateProduct
} from "../services/product.service";
import asyncHandler from "../utils/asyncHandler";
import { presenterName } from "../utils/presenter";
import { successCallback } from "../utils/successResponse";

export const listProductsHandler = asyncHandler(async (_req: Request, res: Response) => {
  const products = await listProducts();
  successCallback(res, "success", "ProductList", "Products loaded", products.map(productToJSON));
});

export const createProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await createProduct(req.body, presenterName(req));
  successCallback(res, "success", "ProductCreate", `Product ${product.name} created`, productToJSON(product));
});

export const updateProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await updateProduct(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "ProductUpdate", "Product updated", productToJSON(product));
});

export const archiveProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await archiveProduct(req.params.id, presenterName(req));
  successCallback(res, "success", "ProductArchive", `${product.name} hidden from the library and new demos`, productToJSON(product));
});

export const restoreProductHandler = asyncHandler(async (req: Request, res: Response) => {
  const product = await restoreProduct(req.params.id, presenterName(req));
  successCallback(res, "success", "ProductRestore", `${product.name} restored`, productToJSON(product));
});

export const reorderProductsHandler = asyncHandler(async (req: Request, res: Response) => {
  const products = await reorderProducts(req.body.ids, presenterName(req));
  successCallback(res, "success", "ProductReorder", "Order saved", products.map(productToJSON));
});
