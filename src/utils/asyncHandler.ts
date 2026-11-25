import { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps an async handler so a rejected promise always reaches next(),
 * avoiding the "bare throw hangs the request" bug noted in be-admin-portal's docs.
 */
const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export default asyncHandler;
