import { Request, Response, Router } from "express";
import env from "../configs/env";
import { objectPath, writePart } from "../storage/localStorage.driver";
import { verify } from "../storage/signing";
import AppError from "../utils/appError";
import asyncHandler from "../utils/asyncHandler";

/**
 * Development-only stand-in for S3: the signed URLs handed out by the local driver point here.
 * Mounted only when STORAGE_DRIVER=local. No team key: the signature in the URL is the permission.
 */
const router = Router();

const expired = () => new AppError(403, "This link has expired or is not valid");

router.put(
  "/parts/:uploadId/:partNumber",
  asyncHandler(async (req: Request, res: Response) => {
    const { uploadId } = req.params;
    const partNumber = Number(req.params.partNumber);
    const exp = Number(req.query.exp);
    if (!Number.isInteger(partNumber) || partNumber < 1) throw new AppError(400, "Invalid part number");
    if (!verify(`PUT\n${uploadId}\n${partNumber}\n${exp}`, String(req.query.sig ?? ""), exp)) throw expired();
    // Browsers always send Content-Length for a part, so oversize parts are refused before reading.
    if (Number(req.header("content-length")) > env.uploadPartBytes) {
      res.setHeader("Connection", "close");
      throw new AppError(413, `Part is larger than the allowed ${env.uploadPartBytes} bytes`);
    }
    const etag = await writePart(uploadId, partNumber, req, env.uploadPartBytes);
    res.setHeader("ETag", etag);
    res.status(200).end();
  })
);

router.get(
  "/objects/*",
  asyncHandler(async (req: Request, res: Response) => {
    const key = (req.params as Record<string, string>)[0];
    const exp = Number(req.query.exp);
    if (!verify(`GET\n${key}\n${exp}`, String(req.query.sig ?? ""), exp)) throw expired();
    // sendFile supports Range requests, so videos can be seeked like on a CDN.
    res.sendFile(objectPath(key), {
      headers: { "Cross-Origin-Resource-Policy": "cross-origin", "Cache-Control": "private, max-age=3600" }
    });
  })
);

export default router;
