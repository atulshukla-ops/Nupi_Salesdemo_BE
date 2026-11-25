import Joi from "joi";

export const updateSettingsSchema = Joi.object({
  aboutText: Joi.string().allow("").max(1000).required(),
  pillars: Joi.array()
    .items(
      Joi.object({
        title: Joi.string().trim().min(1).max(60).required(),
        text: Joi.string().allow("").max(200).required()
      })
    )
    .length(3)
    .required()
    .messages({ "array.length": "Exactly three highlights are required" })
});
