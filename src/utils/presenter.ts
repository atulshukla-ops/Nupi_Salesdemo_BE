import { Request } from "express";

/**
 * Free-text presenter name from the X-Presenter-Name header (URL-encoded by the frontend).
 * Used only for attribution (CreatedBy / UpdatedBy), never for access control.
 */
export const presenterName = (req: Request): string | null => {
  const raw = req.header("x-presenter-name");
  if (!raw) return null;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* keep raw value */
  }
  name = name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80);
  return name || null;
};
