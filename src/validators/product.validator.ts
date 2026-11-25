import Joi from "joi";
import { hexColor, orderedIds } from "./common.validator";

const name = Joi.string().trim().min(1).max(40);

export const createProductSchema = Joi.object({
  name: name.required(),
  description: Joi.string().allow("").max(200).default(""),
  color: hexColor().default("#AFDAE1"),
  talkingPoints: Joi.string().allow("").max(5000).default("")
});

export const updateProductSchema = Joi.object({
  name,
  description: Joi.string().allow("").max(200),
  color: hexColor(),
  talkingPoints: Joi.string().allow("").max(5000)
})
  .min(1)
  .messages({ "object.min": "Nothing to update" });

export const reorderProductsSchema = Joi.object({
  ids: orderedIds().required()
});
