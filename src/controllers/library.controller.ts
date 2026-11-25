import { Request, Response } from "express";
import { getBootstrap, getTrash } from "../services/library.service";
import { getSettings, updateSettings } from "../services/settings.service";
import asyncHandler from "../utils/asyncHandler";
import { presenterName } from "../utils/presenter";
import { successCallback } from "../utils/successResponse";

export const bootstrapHandler = asyncHandler(async (_req: Request, res: Response) => {
  successCallback(res, "success", "Bootstrap", "Library loaded", await getBootstrap());
});

export const trashHandler = asyncHandler(async (_req: Request, res: Response) => {
  successCallback(res, "success", "TrashList", "Trash loaded", await getTrash());
});

export const getSettingsHandler = asyncHandler(async (_req: Request, res: Response) => {
  successCallback(res, "success", "SettingsGet", "Settings loaded", await getSettings());
});

export const updateSettingsHandler = asyncHandler(async (req: Request, res: Response) => {
  successCallback(res, "success", "SettingsUpdate", "Settings saved", await updateSettings(req.body, presenterName(req)));
});
