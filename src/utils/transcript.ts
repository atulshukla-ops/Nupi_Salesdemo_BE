import { createHmac, timingSafeEqual } from "crypto";
import { TranscriptData } from "../constants/types";
import type { VendorTranscript } from "../services/fireflies.client";

/** Pure helpers for meeting transcripts (no database, no network), so they are easy to test. */

/** Meeting hosts the notetaker is used with: Microsoft Teams and Google Meet. */
const MEETING_HOSTS = ["meet.google.com", "teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"];

const parse = (link: string) => {
  try {
    return new URL(link.trim());
  } catch {
    return null;
  }
};

export const isMeetingLink = (link: string) => {
  const u = parse(link);
  if (!u || u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  return MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
};

/**
 * The same meeting can be written in slightly different ways (case, trailing slash, tracking
 * parameters). Host + decoded path identifies it for Meet ("/abc-defg-hij") and Teams
 * ("/l/meetup-join/19:meeting_…@thread.v2/0", "/meet/123456789").
 */
export const normalizeMeetingLink = (link: string | null | undefined) => {
  const u = link ? parse(link) : null;
  if (!u) return null;
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    /* keep it as it is */
  }
  return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path.replace(/\/+$/, "")}`.toLowerCase();
};

/**
 * Our marker in the transcript title, so a transcript finds exactly its session:
 * "[sdr:<session id>]" (the full id, so two sessions can never share a marker).
 */
export const sessionTag = (sessionId: string) => `[sdr:${sessionId.toLowerCase()}]`;
export const tagFromTitle = (title: string | null | undefined) =>
  /\[sdr:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]/i.exec(title ?? "")?.[1]?.toLowerCase() ?? null;

export const transcriptTitle = (demo: { name: string; clientName: string }, sessionId: string) => {
  const who = demo.clientName ? `${demo.clientName} · ${demo.name}` : demo.name;
  const tag = ` ${sessionTag(sessionId)}`;
  return `${who.slice(0, 256 - tag.length - 12)} · NUPI demo${tag}`.slice(0, 256);
};

/**
 * Webhook check: Fireflies signs the raw body with HMAC-SHA256 and the signing secret, and sends
 * "sha256=<hex>" in X-Hub-Signature. Constant-time comparison.
 */
export const verifyWebhookSignature = (rawBody: Buffer, header: string | undefined, secret: string) => {
  if (!secret || !header) return false;
  const given = header.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (!/^[0-9a-f]{64}$/.test(given)) return false;
  return timingSafeEqual(Buffer.from(given, "hex"), Buffer.from(expected, "hex"));
};

/** Fireflies sends dates as epoch milliseconds or ISO text. */
export const vendorDate = (d: number | string | null | undefined) => {
  if (d === null || d === undefined || d === "") return null;
  const t = typeof d === "number" ? d : /^\d+$/.test(d) ? Number(d) : Date.parse(d);
  return Number.isFinite(t) ? new Date(t) : null;
};

const lines = (v: string | string[] | null | undefined) =>
  (Array.isArray(v) ? v : (v ?? "").split(/\r?\n/))
    .map((l) => l.trim().replace(/^[-•*]\s+/, ""))
    .filter(Boolean);

const unbold = (s: string) => s.replace(/\*\*/g, "").trim();

/**
 * Action items come as text grouped under bold names:
 *   "**Asha**\nSend the pricing sheet (03:12)\n**Ravi**\nBook a follow-up"
 * → ["Asha: Send the pricing sheet (03:12)", "Ravi: Book a follow-up"]
 */
export const parseActionItems = (v: string | string[] | null | undefined) => {
  const out: string[] = [];
  let owner = "";
  for (const l of lines(v)) {
    if (/^\*\*[^*]+\*\*:?$/.test(l)) {
      owner = unbold(l).replace(/:$/, "");
      continue;
    }
    out.push(owner ? `${owner}: ${unbold(l)}` : unbold(l));
  }
  return out.slice(0, 100);
};

const MAX_SENTENCES = 6000;

/** The vendor transcript → what we keep. */
export const compactTranscript = (t: VendorTranscript): TranscriptData => {
  const sentences = (t.sentences ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .filter((s) => s.text?.trim())
    .slice(0, MAX_SENTENCES)
    .map((s) => ({ speaker: (s.speaker_name || "Speaker").slice(0, 80), text: s.text!.trim().slice(0, 2000), at: Math.max(0, Math.round(s.start_time ?? 0)) }));
  const speakers = [...new Set([...(t.speakers ?? []).map((s) => s.name?.trim()).filter((n): n is string => !!n), ...sentences.map((s) => s.speaker)])];
  const kw = t.summary?.keywords;
  return {
    title: (t.title || "Meeting").slice(0, 256),
    durationMin: typeof t.duration === "number" && Number.isFinite(t.duration) ? Math.round(t.duration * 10) / 10 : null,
    url: t.transcript_url || null,
    overview: unbold(t.summary?.overview ?? "").slice(0, 8000),
    actionItems: parseActionItems(t.summary?.action_items),
    keywords: (Array.isArray(kw) ? kw : (kw ?? "").split(",")).map((k) => k.trim()).filter(Boolean).slice(0, 30),
    bullets: lines(t.summary?.shorthand_bullet).map(unbold).slice(0, 60),
    speakers: speakers.slice(0, 50),
    sentences
  };
};
