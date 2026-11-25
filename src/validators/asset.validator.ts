import Joi from "joi";
import { orderedIds, uuid } from "./common.validator";

export const listAssetsQuerySchema = Joi.object({
  productId: uuid()
});

export const updateAssetSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120),
  description: Joi.string().allow("").max(300),
  notes: Joi.string().allow("").max(5000),
  productId: uuid()
})
  .min(1)
  .messages({ "object.min": "Nothing to update" });

export const reorderAssetsSchema = Joi.object({
  productId: uuid().required(),
  ids: orderedIds().required()
});
