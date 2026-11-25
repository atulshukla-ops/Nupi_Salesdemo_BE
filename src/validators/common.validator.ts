import Joi from "joi";

export const uuid = () => Joi.string().guid({ version: ["uuidv4", "uuidv5", "uuidv7"] });

export const idParamsSchema = Joi.object({
  id: uuid().required().messages({ "string.guid": "id must be a valid id" })
});

/** YYYY-MM-DD that is also a real calendar date. */
export const isoDate = () =>
  Joi.string()
    .pattern(/^\d{4}-\d{2}-\d{2}$/)
    .custom((value: string, helpers) => {
      const d = new Date(`${value}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? helpers.error("any.invalid") : value;
    })
    .messages({ "string.pattern.base": "date must be in YYYY-MM-DD format", "any.invalid": "date is not a real date" });

export const hexColor = () =>
  Joi.string()
    .pattern(/^#[0-9a-fA-F]{6}$/)
    .messages({ "string.pattern.base": "color must look like #AFDAE1" });

/** Full new order of a list: every id exactly once. */
export const orderedIds = () => Joi.array().items(uuid()).unique().min(1).max(500);
