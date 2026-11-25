/** One product block in a demo's run of show (same shape as the frontend's DemoTab, renamed). */
export interface RunOfShowItem {
  assetId: string;
  enabled: boolean;
}
export interface RunOfShowSection {
  productId: string;
  enabled: boolean;
  items: RunOfShowItem[];
}
export type RunOfShow = RunOfShowSection[];

export interface DemoWelcome {
  headline: string;
  showAgenda: boolean;
}

export interface DemoOptions {
  autoPlay: boolean;
  tabIntros: boolean;
  holdText: string;
}

export interface Pillar {
  title: string;
  text: string;
}

export type AssetKind = "video" | "deck";
export type AssetStatus = "uploading" | "processing" | "ready" | "failed";

/** An upload in progress for an asset (new file or replacement). Filled in milestone M2. */
export interface PendingUpload {
  purpose: "new" | "replace";
  state: "uploading" | "processing" | "failed";
  uploadId: string;
  objectKey: string;
  version: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  partSize: number;
  partCount: number;
  startedAt: string;
  failureReason?: string;
}

export interface SessionViewer {
  viewerId: string;
  name: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export const DEFAULT_WELCOME: DemoWelcome = { headline: "", showAgenda: true };
export const DEFAULT_OPTIONS: DemoOptions = { autoPlay: true, tabIntros: true, holdText: "We'll be right back" };
