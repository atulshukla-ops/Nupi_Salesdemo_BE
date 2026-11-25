import { NextFunction, Request, Response } from "express";
import Joi from "joi";
import AppError from "../utils/appError";

type Source = "body" | "query" | "params";

/**
 * Same contract as be-admin-portal's validate(): 422 with the first Joi message on failure.
 * Additionally replaces req[source] with the cleaned value (defaults applied, unknown keys removed),
 * so services only ever see validated input.
 */
export const validate =
  (schema: Joi.Schema, source: Source = "body") =>
  (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[source] ?? {}, { stripUnknown: true, convert: true });
    if (error) return next(new AppError(422, error.details[0].message));
    (req as unknown as Record<Source, unknown>)[source] = value;
    next();
  };

export const validateQuery = (schema: Joi.Schema) => validate(schema, "query");
export const validateParams = (schema: Joi.Schema) => validate(schema, "params");
