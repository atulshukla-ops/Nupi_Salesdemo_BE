import { Between, In, IsNull } from "typeorm";
import env from "../configs/env";
import { Demo } from "../entities/demo.entity";
import { DemoSession } from "../entities/demoSession.entity";
import { enqueueTranscriptFetch } from "../jobs/boss";
import AppError from "../utils/appError";
import { isUniqueViolation } from "../utils/dbErrors";
import logger from "../utils/logger";
import { compactTranscript, normalizeMeetingLink, tagFromTitle, transcriptTitle, vendorDate, verifyWebhookSignature } from "../utils/transcript";
import { addToLiveMeeting, findTranscripts, getTranscript, transcriptionEnabled, VendorTranscript } from "./fireflies.client";

/**
 * Meeting transcription flow:
 *  1. The presenter goes live (a session opens), pastes the Teams / Meet link and clicks
 *     "Invite notetaker" → Fireflies' bot joins the call (addToLiveMeeting). The title carries
 *     a marker of the session ("[sdr:1a2b3c4d]").
 *  2. After the call Fireflies calls our webhook → a job fetches the transcript + summary and
 *     saves it on the matching session (by marker, else by meeting link and time).
 *  3. Live history shows it; "Fetch again" re-checks if the webhook was missed.
 */

const HOUR = 60 * 60 * 1000;
const NOTETAKER_MAX_MINUTES = 120; // the longest Fireflies allows for addToLiveMeeting

const findDemo = async (id: string) => {
  const demo = await Demo.findOneBy({ id, isTemplate: false, deletedAt: IsNull() });
  if (!demo) throw new AppError(404, "Demo not found");
  return demo;
};

const findSession = async (demoId: string, sessionId: string) => {
  const s = await DemoSession.findOneBy({ id: sessionId, demoId });
  if (!s) throw new AppError(404, "Live session not found");
  return s;
};

/** Status as shown to people: a transcript that never came after TRANSCRIPT_WAIT_HOURS is "unavailable". */
const shownStatus = (s: DemoSession) =>
  s.transcriptStatus === "requested" && s.transcriptRequestedAt && Date.now() - s.transcriptRequestedAt.getTime() > env.transcriptWaitHours * HOUR
    ? "unavailable"
    : s.transcriptStatus;

/** For the live-history list: the summary, not the full text. */
export const transcriptSummaryJSON = (s: DemoSession) => ({
  status: shownStatus(s),
  language: s.transcriptLanguage,
  requestedAt: s.transcriptRequestedAt,
  readyAt: s.transcriptReadyAt,
  error: s.transcriptError,
  ...(s.transcript && {
    title: s.transcript.title,
    durationMin: s.transcript.durationMin,
    url: s.transcript.url,
    overview: s.transcript.overview,
    actionItems: s.transcript.actionItems,
    keywords: s.transcript.keywords,
    speakers: s.transcript.speakers,
    sentenceCount: s.transcript.sentences.length
  })
});

// ---------- 1. invite the notetaker ----------

export const inviteNotetaker = async (demoId: string, input: { meetingLink: string; language: string }) => {
  const demo = await findDemo(demoId);
  const session = await DemoSession.findOne({ where: { demoId, endedAt: IsNull() }, order: { startedAt: "DESC" } });
  if (!session) throw new AppError(409, "Open the console and go live first: the transcript is saved with the live session.");

  // Remember the link on the demo even if the notetaker call fails (the presenter can retry).
  if (demo.meetingLink !== input.meetingLink) await Demo.update({ id: demo.id }, { meetingLink: input.meetingLink });

  await addToLiveMeeting({
    meetingLink: input.meetingLink,
    title: transcriptTitle(demo, session.id),
    language: input.language,
    durationMin: NOTETAKER_MAX_MINUTES
  });
  Object.assign(session, {
    meetingLink: input.meetingLink,
    transcriptLanguage: input.language,
    transcriptRequestedAt: new Date(),
    transcriptError: null,
    // a transcript already saved for this session stays; a new one replaces it when it arrives
    transcriptStatus: session.transcriptStatus === "ready" ? "ready" : "requested"
  });
  await session.save();
  logger.info(`Notetaker sent to the call of demo ${demo.id} (session ${session.id}, ${input.language})`);
  return { sessionId: session.id, status: session.transcriptStatus, meetingLink: input.meetingLink, language: input.language };
};

// ---------- 2. webhook + fetch ----------

const FETCH_EVENTS = new Set(["meeting.transcribed", "meeting.summarized", "transcription completed", "transcription complete"]);

/**
 * The notetaker's webhook. Checks the signature, then only queues a job (the vendor wants an
 * answer within 30 s; fetching a long transcript can take longer).
 */
export const handleWebhook = async (rawBody: Buffer, signature: string | undefined) => {
  if (!transcriptionEnabled() || !env.firefliesWebhookSecret) throw new AppError(503, "Transcription webhooks are not set up on this server");
  if (!verifyWebhookSignature(rawBody, signature, env.firefliesWebhookSecret)) throw new AppError(401, "Invalid webhook signature");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "Request body is not valid JSON");
  }
  // Webhooks V2: { event, meeting_id }. V1 (deprecated): { eventType, meetingId }.
  const event = String(body.event ?? body.eventType ?? "");
  const meetingId = String(body.meeting_id ?? body.meetingId ?? "");
  if (!meetingId || meetingId.length > 100) throw new AppError(400, "meeting_id is missing");
  if (!FETCH_EVENTS.has(event.toLowerCase())) {
    logger.info(`Notetaker webhook "${event}" for meeting ${meetingId}: nothing to fetch`);
    return { queued: false };
  }
  await enqueueTranscriptFetch(meetingId, event);
  logger.info(`Notetaker webhook "${event}": transcript ${meetingId} queued`);
  return { queued: true };
};

/** Which session a vendor transcript belongs to: same vendor id → our marker → same meeting link near that time. */
const matchSession = async (t: VendorTranscript): Promise<DemoSession | null> => {
  const byId = await DemoSession.findOneBy({ transcriptVendorId: t.id });
  if (byId) return byId;

  const tag = tagFromTitle(t.title);
  if (tag) {
    const byTag = await DemoSession.createQueryBuilder("s").where(`s."Id"::text LIKE :p`, { p: `${tag}%` }).orderBy(`s."StartedAt"`, "DESC").getOne();
    if (byTag) return byTag;
  }

  // No marker: the notetaker was invited another way (e.g. through the calendar invite).
  const link = normalizeMeetingLink(t.meeting_link);
  if (!link) return null;
  const at = vendorDate(t.date) ?? new Date();
  const candidates = await DemoSession.find({ where: { startedAt: Between(new Date(at.getTime() - 12 * HOUR), new Date(at.getTime() + 12 * HOUR)), transcriptVendorId: IsNull() } });
  if (!candidates.length) return null;
  const demos = new Map((await Demo.findBy({ id: In([...new Set(candidates.map((c) => c.demoId))]) })).map((d) => [d.id, d]));
  const same = candidates.filter((c) => normalizeMeetingLink(c.meetingLink ?? demos.get(c.demoId)?.meetingLink) === link);
  same.sort((a, b) => Math.abs(a.startedAt.getTime() - at.getTime()) - Math.abs(b.startedAt.getTime() - at.getTime()));
  return same[0] ?? null;
};

/**
 * Downloads one transcript from the notetaker and saves it on its session.
 * Returns the session it was saved on, or null if it is not from a Demo Room call.
 */
export const fetchAndSaveTranscript = async (meetingId: string, forSession?: DemoSession) => {
  const t = await getTranscript(meetingId);
  const session = forSession ?? (await matchSession(t));
  if (!session) {
    logger.info(`Transcript ${meetingId} ("${t.title ?? ""}") is not from a Demo Room session: ignored`);
    return null;
  }
  const data = compactTranscript(t);
  Object.assign(session, {
    transcriptVendorId: t.id,
    transcript: data,
    transcriptStatus: "ready",
    transcriptReadyAt: new Date(),
    transcriptError: null,
    meetingLink: session.meetingLink ?? t.meeting_link ?? null
  });
  try {
    await session.save();
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn(`Transcript ${t.id} is already saved on another session: ignored`);
      return null;
    }
    throw error;
  }
  logger.info(`Transcript ${t.id} saved on session ${session.id} (${data.sentences.length} sentences)`);
  return session;
};

// ---------- 3. read + fetch again ----------

export const getSessionTranscript = async (demoId: string, sessionId: string) => {
  await findDemo(demoId);
  const s = await findSession(demoId, sessionId);
  if (!s.transcript) throw new AppError(404, "This session has no transcript yet");
  return { sessionId: s.id, language: s.transcriptLanguage, readyAt: s.transcriptReadyAt, ...s.transcript };
};

/** "Fetch again": for when the webhook was late, missed, or the first fetch failed. */
export const refetchTranscript = async (demoId: string, sessionId: string) => {
  const demo = await findDemo(demoId);
  const s = await findSession(demoId, sessionId);
  if (s.transcriptVendorId) {
    await fetchAndSaveTranscript(s.transcriptVendorId, s);
    return { found: true, transcript: transcriptSummaryJSON(s) };
  }
  const link = normalizeMeetingLink(s.meetingLink ?? demo.meetingLink);
  if (s.transcriptStatus === "none" && !link) throw new AppError(400, "No notetaker was invited to this session.");
  const recent = await findTranscripts(new Date(s.startedAt.getTime() - HOUR), new Date((s.endedAt ?? new Date()).getTime() + 12 * HOUR));
  const mine = recent.find((t) => tagFromTitle(t.title) === s.id.slice(0, 8).toLowerCase()) ?? (link ? recent.find((t) => normalizeMeetingLink(t.meeting_link) === link) : undefined);
  if (!mine) return { found: false, transcript: transcriptSummaryJSON(s) };
  await fetchAndSaveTranscript(mine.id, s);
  return { found: true, transcript: transcriptSummaryJSON(s) };
};
