import { timingSafeEqual } from "crypto";
import { NextFunction, Request, Response } from "express";
import env from "../configs/env";
import AppError from "../utils/appError";

/**
 * No login yet: every presenter API call must carry the shared team key in X-Team-Key.
 * Compared in constant time so the key cannot be guessed from response timings.
 */
export const requireTeamKey = (req: Request, _res: Response, next: NextFunction) => {
  const given = Buffer.from(req.header("x-team-key") ?? "");
  const expected = Buffer.from(env.teamKey);
  if (!expected.length || given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return next(new AppError(401, "Missing or invalid team key"));
  }
  next();
};
