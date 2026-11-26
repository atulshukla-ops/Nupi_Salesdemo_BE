import { Between, In, IsNull, MoreThan } from "typeorm";
import env from "../configs/env";
import { Demo } from "../entities/demo.entity";
import { DemoSession } from "../entities/demoSession.entity";
import { enqueueTranscriptFetch } from "../jobs/boss";
import AppError from "../utils/appError";
import { isUniqueViolation } from "../utils/dbErrors";
import logger from "../utils/logger";
import { TranscriptData } from "../constants/types";
import { compactTranscript, normalizeMeetingLink, tagFromTitle, transcriptTitle, vendorDate, verifyWebhookSignature } from "../utils/transcript";
import { addToLiveMeeting, findTranscripts, getTranscript, NotetakerConfigError, transcriptionEnabled, VendorTranscript } from "./fireflies.client";

/**
 * Meeting transcription flow:
 *  1. The presenter goes live (a session opens), pastes the Teams / Meet link and clicks
 *     "Invite notetaker" → Fireflies' bot joins the call (addToLiveMeeting). The title carries
 *     a marker of the session ("[sdr:1a2b3c4d]").
 *  2. After the call Fireflies calls our webhook → a job fetches the transcript + summary and
 *     saves it on the matching session: by marker, else (same link) only on a session that
 *     invited the notetaker to that link at about that time. Transcripts of other meetings on
 *     the same (e.g. recurring Teams) link are never attached.
 *  3. Live history shows it; "Fetch again" re-checks if the webhook was missed.
 */

const HOUR = 60 * 60 * 1000;
/** How far apart "invited the notetaker" and the transcript's meeting time may be. */
const LINK_MATCH_WINDOW_MS = 4 * HOUR;
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

type TranscriptHead = Omit<TranscriptData, "sentences" | "bullets"> & { sentenceCount: number };

const headOf = (t: TranscriptData): TranscriptHead => {
  const { sentences, bullets: _bullets, ...rest } = t; // eslint-disable-line @typescript-eslint/no-unused-vars
  return { ...rest, sentenceCount: sentences.length };
};

/**
 * For the live-history list: the summary, not the full text. `head` comes from
 * loadTranscriptHeads (the list never loads the sentences); otherwise it is taken from s.transcript.
 */
export const transcriptSummaryJSON = (s: DemoSession, head?: TranscriptHead | null) => {
  const h = head ?? (s.transcript ? headOf(s.transcript) : null);
  return {
    status: shownStatus(s),
    language: s.transcriptLanguage,
    requestedAt: s.transcriptRequestedAt,
    readyAt: s.transcriptReadyAt,
    error: s.transcriptError,
    ...(h && {
      title: h.title,
      durationMin: h.durationMin,
      url: h.url,
      overview: h.overview,
      actionItems: h.actionItems,
      keywords: h.keywords,
      speakers: h.speakers,
      sentenceCount: h.sentenceCount
    })
  };
};

/** Summaries of saved transcripts, without loading the sentences (they can be megabytes). */
export const loadTranscriptHeads = async (sessionIds: string[]) => {
  const heads = new Map<string, TranscriptHead>();
  if (!sessionIds.length) return heads;
  const rows: { id: string; head: Omit<TranscriptData, "sentences">; n: number }[] = await DemoSession.query(
    `SELECT "Id" AS id, "Transcript" - 'sentences' - 'bullets' AS head, jsonb_array_length(COALESCE("Transcript"->'sentences', '[]'::jsonb)) AS n
       FROM "T_SDR_Demo_Sessions" WHERE "Id" = ANY($1::uuid[]) AND "Transcript" IS NOT NULL`,
    [sessionIds]
  );
  for (const r of rows) heads.set(r.id, { ...r.head, sentenceCount: Number(r.n) });
  return heads;
};

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
    const byTag = await DemoSession.findOneBy({ id: tag });
    if (byTag) return byTag;
  }

  // No marker (title renamed in Fireflies?): only a session that itself invited the notetaker
  // to this exact link, at about the meeting's time, and has no transcript yet. A demo's saved
  // link alone is not enough: Teams links are often recurring, so other meetings share it.
  const link = normalizeMeetingLink(t.meeting_link);
  if (!link) return null;
  const at = vendorDate(t.date) ?? new Date();
  const candidates = await DemoSession.find({
    where: {
      transcriptStatus: In(["requested", "failed"]),
      transcriptVendorId: IsNull(),
      transcriptRequestedAt: Between(new Date(at.getTime() - LINK_MATCH_WINDOW_MS), new Date(at.getTime() + LINK_MATCH_WINDOW_MS))
    }
  });
  const same = candidates.filter((c) => normalizeMeetingLink(c.meetingLink) === link);
  same.sort((a, b) => Math.abs(a.transcriptRequestedAt!.getTime() - at.getTime()) - Math.abs(b.transcriptRequestedAt!.getTime() - at.getTime()));
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
  const changes = {
    transcriptVendorId: t.id,
    transcript: data,
    transcriptStatus: "ready" as const,
    transcriptReadyAt: new Date(),
    transcriptError: null,
    meetingLink: session.meetingLink ?? t.meeting_link ?? null
  };
  try {
    await DemoSession.update({ id: session.id }, changes);
  } catch (error) {
    if (isUniqueViolation(error)) {
      logger.warn(`Transcript ${t.id} is already saved on another session: ignored`);
      return null;
    }
    throw error;
  }
  Object.assign(session, changes); // only after the database has it
  logger.info(`Transcript ${t.id} saved on session ${session.id} (${data.sentences.length} sentences)`);
  return session;
};

/**
 * The worker gave up on a transcript: show the reason instead of "processing" for a day.
 * The session is known when the transcript was matched before (vendor id). A settings problem
 * (key missing / refused) hits every waiting session, so those are marked too.
 */
export const markTranscriptFailed = async (meetingId: string, error: unknown) => {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  const known = await DemoSession.update({ transcriptVendorId: meetingId, transcriptStatus: In(["requested", "failed"]) }, { transcriptStatus: "failed", transcriptError: message });
  let waiting = 0;
  if (error instanceof NotetakerConfigError) {
    const r = await DemoSession.update(
      { transcriptStatus: "requested", transcriptRequestedAt: MoreThan(new Date(Date.now() - env.transcriptWaitHours * HOUR)) },
      { transcriptStatus: "failed", transcriptError: message }
    );
    waiting = r.affected ?? 0;
  }
  return (known.affected ?? 0) + waiting;
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
  await findDemo(demoId);
  const s = await findSession(demoId, sessionId);
  if (s.transcriptStatus === "none") throw new AppError(400, "No notetaker was invited to this session.");
  const result = async (saved: DemoSession | null) => {
    const fresh = await findSession(demoId, sessionId); // what the database really holds
    return { found: !!saved, transcript: transcriptSummaryJSON(fresh) };
  };
  try {
    if (s.transcriptVendorId) return await result(await fetchAndSaveTranscript(s.transcriptVendorId, s));

    // Our marker first; else the same link this session invited the notetaker to, closest in
    // time, and not already saved on another session.
    const recent = await findTranscripts(new Date(s.startedAt.getTime() - HOUR), new Date((s.endedAt ?? new Date()).getTime() + 6 * HOUR));
    let mine = recent.find((t) => tagFromTitle(t.title) === s.id.toLowerCase());
    const link = normalizeMeetingLink(s.meetingLink);
    if (!mine && link && s.transcriptRequestedAt) {
      const asked = s.transcriptRequestedAt.getTime();
      const sameLink = recent.filter((t) => normalizeMeetingLink(t.meeting_link) === link && !tagFromTitle(t.title));
      const taken = new Set(
        sameLink.length ? (await DemoSession.findBy({ transcriptVendorId: In(sameLink.map((t) => t.id)) })).map((x) => x.transcriptVendorId) : []
      );
      mine = sameLink
        .filter((t) => !taken.has(t.id))
        .map((t) => ({ t, gap: Math.abs((vendorDate(t.date)?.getTime() ?? asked) - asked) }))
        .filter((x) => x.gap <= LINK_MATCH_WINDOW_MS)
        .sort((a, b) => a.gap - b.gap)[0]?.t;
    }
    if (!mine) return await result(null);
    return await result(await fetchAndSaveTranscript(mine.id, s));
  } catch (error) {
    // Show why on the session (e.g. the key was refused), then tell the presenter.
    if (error instanceof AppError && error.statusCode >= 500 && s.transcriptStatus !== "ready")
      await DemoSession.update({ id: s.id }, { transcriptStatus: "failed", transcriptError: error.message.slice(0, 300) });
    throw error;
  }
};
