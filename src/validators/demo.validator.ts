import Joi from "joi";
import { isoDate, uuid } from "./common.validator";

export const runOfShowSchema = Joi.array()
  .items(
    Joi.object({
      productId: uuid().required(),
      enabled: Joi.boolean().required(),
      items: Joi.array()
        .items(Joi.object({ assetId: uuid().required(), enabled: Joi.boolean().required() }))
        .unique("assetId")
        .max(300)
        .required()
    })
  )
  .unique("productId")
  .max(100);

export const welcomeSchema = Joi.object({
  headline: Joi.string().allow("").max(120).required(),
  showAgenda: Joi.boolean().required()
});

export const optionsSchema = Joi.object({
  autoPlay: Joi.boolean().required(),
  tabIntros: Joi.boolean().required(),
  holdText: Joi.string().trim().min(1).max(80).required()
});

const demoName = Joi.string().trim().min(1).max(120);
const clientName = Joi.string().trim().allow("").max(120);

export const listQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  take: Joi.number().integer().min(1).max(100).default(20)
});

// ---- client demos ----
export const createDemoSchema = Joi.object({
  name: demoName.default("Product demo"),
  clientName: clientName.default(""),
  date: isoDate().required(),
  headline: Joi.string().trim().allow("").max(120).default(""),
  /** Start from a Standard Flow; without it the demo starts with the whole library enabled. */
  flowId: uuid()
});

export const updateDemoSchema = Joi.object({
  name: demoName,
  clientName,
  date: isoDate(),
  welcome: welcomeSchema,
  options: optionsSchema,
  runOfShow: runOfShowSchema
})
  .min(1)
  .messages({ "object.min": "Nothing to update" });

export const saveAsFlowSchema = Joi.object({
  name: demoName.required(),
  audience: Joi.string().trim().allow("").max(120).default(""),
  description: Joi.string().allow("").max(2000).default(""),
  isRecommended: Joi.boolean().default(false)
});

// ---- standard flows ----
export const createFlowSchema = Joi.object({
  name: demoName.required(),
  audience: Joi.string().trim().allow("").max(120).default(""),
  description: Joi.string().allow("").max(2000).default(""),
  isRecommended: Joi.boolean().default(false),
  welcome: welcomeSchema,
  options: optionsSchema,
  runOfShow: runOfShowSchema
});

export const updateFlowSchema = Joi.object({
  name: demoName,
  audience: Joi.string().trim().allow("").max(120),
  description: Joi.string().allow("").max(2000),
  isRecommended: Joi.boolean(),
  welcome: welcomeSchema,
  options: optionsSchema,
  runOfShow: runOfShowSchema
})
  .min(1)
  .messages({ "object.min": "Nothing to update" });

export const demoFromFlowSchema = Joi.object({
  name: demoName,
  clientName: clientName.default(""),
  date: isoDate().required(),
  headline: Joi.string().trim().allow("").max(120).default("")
});

export const publicSlugParamsSchema = Joi.object({
  slug: Joi.string()
    .pattern(/^[a-z0-9-]{1,160}$/)
    .required()
});
