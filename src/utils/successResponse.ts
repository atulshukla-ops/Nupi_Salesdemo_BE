import { Response } from "express";

// Same envelope as be-admin-portal: { status, act, message, data }, always HTTP 200.
export const successCallback = (
  res: Response,
  status: string,
  act: string,
  message: string,
  data: unknown
) => res.status(200).send({ status, act, message, data });
