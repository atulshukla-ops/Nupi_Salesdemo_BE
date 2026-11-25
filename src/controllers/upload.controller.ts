import { Request, Response } from "express";
import {
  abortUpload,
  completeUpload,
  getPartUrls,
  getUploadedParts,
  startReplaceUpload,
  startUpload
} from "../services/upload.service";
import asyncHandler from "../utils/asyncHandler";
import { presenterName } from "../utils/presenter";
import { successCallback } from "../utils/successResponse";

export const startUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "UploadStart", "Upload started", await startUpload(req.body, presenterName(req)));
});

export const startReplaceUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const session = await startReplaceUpload(req.params.id, req.body, presenterName(req));
  successCallback(res, "success", "UploadReplaceStart", "Replacement upload started", session);
});

export const partUrlsHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "UploadPartUrls", "Part URLs ready", await getPartUrls(req.params.id, req.body.partNumbers));
});

export const uploadedPartsHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "UploadParts", "Uploaded parts loaded", await getUploadedParts(req.params.id));
});

export const completeUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const asset = await completeUpload(req.params.id, req.body.parts, presenterName(req));
  successCallback(res, "success", "UploadComplete", "Upload finished, processing the video", asset);
});

export const abortUploadHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await abortUpload(req.params.id, presenterName(req));
  successCallback(res, "success", "UploadAbort", result.removed ? "Upload cancelled and removed" : "Upload cancelled", result);
});
