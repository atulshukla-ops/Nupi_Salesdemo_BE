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

/** none = no notetaker asked for; requested = notetaker sent to the call, transcript not in yet. */
export type TranscriptStatus = "none" | "requested" | "ready" | "failed";

/** What is kept of a meeting transcript (compact: no vendor-specific fields). */
export interface TranscriptData {
  title: string;
  /** Minutes, as reported by the notetaker. */
  durationMin: number | null;
  /** Link to the full transcript on the notetaker's site (needs a login there). */
  url: string | null;
  overview: string;
  actionItems: string[];
  keywords: string[];
  bullets: string[];
  speakers: string[];
  /** Sentences in order: speaker, text, seconds from the start of the call. */
  sentences: { speaker: string; text: string; at: number }[];
}

export const DEFAULT_WELCOME: DemoWelcome = { headline: "", showAgenda: true };
export const DEFAULT_OPTIONS: DemoOptions = { autoPlay: true, tabIntros: true, holdText: "We'll be right back" };
