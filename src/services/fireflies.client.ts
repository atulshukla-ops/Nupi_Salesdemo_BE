import env from "../configs/env";
import AppError from "../utils/appError";

/**
 * Small client for the Fireflies.ai GraphQL API (the meeting notetaker).
 * Docs: https://docs.fireflies.ai — endpoint POST /graphql with "Authorization: Bearer <API key>".
 * The API key never leaves the server.
 */

export const transcriptionEnabled = () => !!env.firefliesApiKey;

/** The API key is missing or refused: retrying cannot help until an admin fixes the settings. */
export class NotetakerConfigError extends AppError {}

interface GqlError {
  message: string;
  code?: string;
  extensions?: { code?: string; status?: number };
}

/** A vendor error as an AppError the presenter can act on. */
const toAppError = (e: GqlError | undefined, httpStatus: number, retryAfter: string | null) => {
  const code = e?.code || e?.extensions?.code || "";
  if (code === "too_many_requests" || httpStatus === 429) {
    const wait = Number(retryAfter);
    const when = Number.isFinite(wait) && wait > 0 ? ` Try again in ${Math.ceil(wait / 60)} min.` : " Try again in a few minutes.";
    return new AppError(429, `The notetaker service is busy (too many requests).${when}`);
  }
  if (code === "unsupported_platform") return new AppError(400, "The notetaker cannot join this kind of meeting link. Use a Teams or Google Meet link.");
  if (code === "invalid_language_code") return new AppError(400, "The notetaker does not support this language.");
  if (code === "object_not_found") return new AppError(404, "The notetaker has no transcript for this meeting (yet).");
  if (httpStatus === 401 || httpStatus === 403 || /auth|api key|token/i.test(code + (e?.message ?? "")))
    return new NotetakerConfigError(502, "The notetaker service refused our API key. Ask the admin to check FIREFLIES_API_KEY.");
  return new AppError(502, `The notetaker service failed: ${(e?.message || `HTTP ${httpStatus}`).slice(0, 200)}`);
};

export async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!transcriptionEnabled()) throw new NotetakerConfigError(503, "Transcription is not set up on the server (FIREFLIES_API_KEY is empty).");
  let res: Response;
  try {
    res = await fetch(env.firefliesApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.firefliesApiKey}` },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20_000)
    });
  } catch (error) {
    throw new AppError(502, `Could not reach the notetaker service: ${(error as Error).message}`);
  }
  const body = (await res.json().catch(() => null)) as { data?: T; errors?: GqlError[] } | null;
  if (!res.ok || !body || body.errors?.length || !body.data) throw toAppError(body?.errors?.[0], res.status, res.headers.get("retry-after"));
  return body.data;
}

/** Sends the notetaker bot into a meeting that is happening now. */
export async function addToLiveMeeting(input: { meetingLink: string; title: string; language: string; durationMin: number }) {
  const data = await gql<{ addToLiveMeeting: { success: boolean } }>(
    `mutation AddToLiveMeeting($meetingLink: String!, $title: String, $language: String, $duration: Int) {
      addToLiveMeeting(meeting_link: $meetingLink, title: $title, language: $language, duration: $duration) { success }
    }`,
    { meetingLink: input.meetingLink, title: input.title, language: input.language, duration: input.durationMin }
  );
  if (!data.addToLiveMeeting?.success) throw new AppError(502, "The notetaker service did not accept the meeting.");
}

export interface VendorTranscript {
  id: string;
  title: string | null;
  date: number | string | null;
  duration: number | null;
  meeting_link: string | null;
  transcript_url: string | null;
  speakers: { id: string | number; name: string | null }[] | null;
  sentences: { index: number; speaker_name: string | null; text: string | null; start_time: number | null }[] | null;
  summary: { overview: string | null; action_items: string | string[] | null; keywords: string[] | string | null; shorthand_bullet: string | string[] | null } | null;
}

export async function getTranscript(id: string): Promise<VendorTranscript> {
  const data = await gql<{ transcript: VendorTranscript | null }>(
    `query Transcript($id: String!) {
      transcript(id: $id) {
        id title date duration meeting_link transcript_url
        speakers { id name }
        sentences { index speaker_name text start_time }
        summary { overview action_items keywords shorthand_bullet }
      }
    }`,
    { id }
  );
  if (!data.transcript) throw new AppError(404, "The notetaker has no transcript for this meeting (yet).");
  return data.transcript;
}

/** Recent transcripts (newest first), for "Fetch again" when the webhook never arrived. */
export async function findTranscripts(fromDate: Date, toDate: Date) {
  const data = await gql<{ transcripts: { id: string; title: string | null; date: number | string | null; meeting_link: string | null }[] | null }>(
    `query Transcripts($fromDate: DateTime, $toDate: DateTime, $limit: Int) {
      transcripts(fromDate: $fromDate, toDate: $toDate, limit: $limit) { id title date meeting_link }
    }`,
    { fromDate: fromDate.toISOString(), toDate: toDate.toISOString(), limit: 50 }
  );
  return data.transcripts ?? [];
}
