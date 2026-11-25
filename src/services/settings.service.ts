import { Pillar } from "../constants/types";
import { WorkspaceSettings } from "../entities/workspaceSettings.entity";
import AppError from "../utils/appError";

const toJSON = (s: WorkspaceSettings) => ({
  aboutText: s.aboutText,
  pillars: s.pillars,
  updatedBy: s.updatedBy,
  updatedAt: s.updatedAt
});

const loadRow = async () => {
  const row = await WorkspaceSettings.findOneBy({ id: 1 });
  // The row is created by the first migration; missing means the database was not set up correctly.
  if (!row) throw new AppError(500, "Workspace settings are missing — run the database migrations");
  return row;
};

export const getSettings = async () => toJSON(await loadRow());

export const updateSettings = async (data: { aboutText: string; pillars: Pillar[] }, by: string | null) => {
  const row = await loadRow();
  row.aboutText = data.aboutText;
  row.pillars = data.pillars;
  row.updatedBy = by;
  await row.save();
  return toJSON(row);
};
