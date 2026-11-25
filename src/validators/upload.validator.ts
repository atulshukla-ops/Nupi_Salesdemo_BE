import Joi from "joi";
import env from "../configs/env";
import { uuid } from "./common.validator";

/** Video formats accepted for upload (anything else is rejected before a byte is sent). */
export const VIDEO_TYPES: Record<string, string[]> = {
  "video/mp4": ["mp4"],
  "video/quicktime": ["mov"],
  "video/webm": ["webm"],
  "video/x-m4v": ["m4v"]
};

const fileFields = {
  fileName: Joi.string().trim().min(1).max(255).required(),
  sizeBytes: Joi.number()
    .integer()
    .min(1)
    .max(env.maxUploadBytes)
    .required()
    .messages({ "number.max": `File is too large. The limit is ${Math.round(env.maxUploadBytes / 1024 ** 3)} GB` }),
  mimeType: Joi.string()
    .valid(...Object.keys(VIDEO_TYPES))
    .required()
    .messages({ "any.only": "Only MP4, MOV, WebM or M4V videos can be uploaded" })
};

export const startUploadSchema = Joi.object({
  productId: uuid().required(),
  ...fileFields,
  title: Joi.string().trim().min(1).max(120),
  description: Joi.string().allow("").max(300).default(""),
  notes: Joi.string().allow("").max(5000).default("")
});

export const replaceUploadSchema = Joi.object(fileFields);

export const partUrlsSchema = Joi.object({
  partNumbers: Joi.array().items(Joi.number().integer().min(1).max(10000)).unique().min(1).max(100).required()
});

export const completeUploadSchema = Joi.object({
  parts: Joi.array()
    .items(Joi.object({ partNumber: Joi.number().integer().min(1).max(10000).required(), etag: Joi.string().max(200).required() }))
    .unique("partNumber")
    .min(1)
    .max(10000)
    .required()
});
