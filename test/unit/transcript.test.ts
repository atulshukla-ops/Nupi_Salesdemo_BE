import { createHmac } from "crypto";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../src/app";
import { addToLiveMeeting, getTranscript } from "../../src/services/fireflies.client";
import {
  compactTranscript,
  isMeetingLink,
  normalizeMeetingLink,
  parseActionItems,
  sessionTag,
  tagFromTitle,
  transcriptTitle,
  vendorDate,
  verifyWebhookSignature
} from "../../src/utils/transcript";
import { notetakerSchema, updateDemoSchema } from "../../src/validators/demo.validator";

const SECRET = process.env.FIREFLIES_WEBHOOK_SECRET as string;
const sign = (body: string, secret = SECRET) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const SESSION = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

describe("meeting links", () => {
  it("accepts Teams and Google Meet links only (https)", () => {
    expect(isMeetingLink("https://meet.google.com/abc-defg-hij")).toBe(true);
    expect(isMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=%7b%7d")).toBe(true);
    expect(isMeetingLink("https://teams.live.com/meet/9876543210")).toBe(true);
    expect(isMeetingLink("http://meet.google.com/abc-defg-hij")).toBe(false);
    expect(isMeetingLink("https://meet.google.com.evil.example/abc")).toBe(false);
    expect(isMeetingLink("https://zoom.us/j/123")).toBe(false);
    expect(isMeetingLink("not a link")).toBe(false);
  });

  it("the same meeting written differently normalises to one value", () => {
    const a = normalizeMeetingLink("https://meet.google.com/ABC-defg-hij/");
    expect(a).toBe("meet.google.com/abc-defg-hij");
    expect(normalizeMeetingLink("https://meet.google.com/abc-defg-hij?authuser=1&hs=179")).toBe(a);
    expect(normalizeMeetingLink("https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0?context=1")).toBe(
      normalizeMeetingLink("https://teams.microsoft.com/l/meetup-join/19:meeting_x@thread.v2/0")
    );
    expect(normalizeMeetingLink(null)).toBeNull();
  });

  it("validators: notetaker needs a meeting link; language en/hi; demo meetingLink can be cleared", () => {
    expect(notetakerSchema.validate({ meetingLink: "https://meet.google.com/abc-defg-hij" }).value.language).toBe("en");
    expect(notetakerSchema.validate({ meetingLink: "https://meet.google.com/abc-defg-hij", language: "hi" }).error).toBeUndefined();
    expect(notetakerSchema.validate({ meetingLink: "https://meet.google.com/abc-defg-hij", language: "fr" }).error?.message).toMatch(/en \(English\) or hi/);
    expect(notetakerSchema.validate({ meetingLink: "https://example.com/x" }).error?.message).toMatch(/Teams or Google Meet/);
    expect(updateDemoSchema.validate({ meetingLink: "" }).error).toBeUndefined();
    expect(updateDemoSchema.validate({ meetingLink: null }).error).toBeUndefined();
    expect(updateDemoSchema.validate({ meetingLink: "https://example.com" }).error).toBeDefined();
  });
});

describe("session marker in the transcript title", () => {
  it("round-trips the first 8 characters of the session id", () => {
    const title = transcriptTitle({ name: "Rewards demo", clientName: "Acme" }, SESSION);
    expect(title).toBe(`Acme · Rewards demo · NUPI demo ${sessionTag(SESSION)}`);
    expect(tagFromTitle(title)).toBe("1a2b3c4d");
    expect(tagFromTitle("Weekly sync")).toBeNull();
  });

  it("stays within the 256-character limit and keeps the marker", () => {
    const title = transcriptTitle({ name: "x".repeat(300), clientName: "y".repeat(300) }, SESSION);
    expect(title.length).toBeLessThanOrEqual(256);
    expect(tagFromTitle(title)).toBe("1a2b3c4d");
  });
});

describe("webhook signature", () => {
  const body = Buffer.from('{"event":"meeting.transcribed","meeting_id":"M1"}');
  it("accepts sha256=<hex> and bare hex; rejects wrong secrets, tampering and junk", () => {
    expect(verifyWebhookSignature(body, sign(body.toString()), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body.toString()).slice(7), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body, sign(body.toString(), "other"), SECRET)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(body.toString() + " "), sign(body.toString()), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=zz", SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, undefined, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body.toString()), "")).toBe(false);
  });
});

describe("transcript from the notetaker", () => {
  it("action items grouped under bold names get the owner in front", () => {
    expect(parseActionItems("**Asha**\nSend the pricing sheet (03:12)\n- Share the deck\n**Ravi:**\nBook a follow-up\n\n")).toEqual([
      "Asha: Send the pricing sheet (03:12)",
      "Asha: Share the deck",
      "Ravi: Book a follow-up"
    ]);
    expect(parseActionItems(["One", "Two"])).toEqual(["One", "Two"]);
    expect(parseActionItems(null)).toEqual([]);
  });

  it("dates: epoch ms, numeric text and ISO", () => {
    expect(vendorDate(1764000000000)?.toISOString()).toBe("2025-11-24T16:00:00.000Z");
    expect(vendorDate("1764000000000")?.getTime()).toBe(1764000000000);
    expect(vendorDate("2026-11-26T10:00:00Z")?.toISOString()).toBe("2026-11-26T10:00:00.000Z");
    expect(vendorDate(null)).toBeNull();
    expect(vendorDate("nope")).toBeNull();
  });

  it("is kept compact: ordered sentences, speakers, summary parts (Hindi text kept as is)", () => {
    const t = compactTranscript({
      id: "T1",
      title: "Acme · NUPI demo [sdr:1a2b3c4d]",
      date: 1764000000000,
      duration: 32.46,
      meeting_link: "https://meet.google.com/abc-defg-hij",
      transcript_url: "https://app.fireflies.ai/view/T1",
      speakers: [{ id: 1, name: "Asha" }],
      sentences: [
        { index: 2, speaker_name: "Ravi", text: "  हमें प्राइसिंग दिखाइए  ", start_time: 12.6 },
        { index: 1, speaker_name: "Asha", text: "Welcome to NUPI.", start_time: 0.2 },
        { index: 3, speaker_name: null, text: "   ", start_time: 20 }
      ],
      summary: { overview: "**Pricing** discussed.", action_items: "**Asha**\nSend pricing", keywords: "pricing, rewards ,", shorthand_bullet: "- Intro\n- Pricing" }
    });
    expect(t.sentences).toEqual([
      { speaker: "Asha", text: "Welcome to NUPI.", at: 0 },
      { speaker: "Ravi", text: "हमें प्राइसिंग दिखाइए", at: 13 }
    ]);
    expect(t.speakers).toEqual(["Asha", "Ravi"]);
    expect(t).toMatchObject({ durationMin: 32.5, url: "https://app.fireflies.ai/view/T1", overview: "Pricing discussed.", actionItems: ["Asha: Send pricing"], keywords: ["pricing", "rewards"], bullets: ["Intro", "Pricing"] });
  });

  it("works when the summary is not there yet", () => {
    const t = compactTranscript({ id: "T2", title: null, date: null, duration: null, meeting_link: null, transcript_url: null, speakers: null, sentences: null, summary: null });
    expect(t).toMatchObject({ title: "Meeting", overview: "", actionItems: [], keywords: [], sentences: [], speakers: [] });
  });
});

describe("Fireflies client (fetch stubbed)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }));

  it("sends the API key as a Bearer token and the meeting details", async () => {
    const f = reply(200, { data: { addToLiveMeeting: { success: true } } });
    vi.stubGlobal("fetch", f);
    await addToLiveMeeting({ meetingLink: "https://meet.google.com/abc-defg-hij", title: "T", language: "hi", durationMin: 120 });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://fireflies.test/graphql");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-fireflies-key");
    expect(JSON.parse(init.body as string).variables).toEqual({ meetingLink: "https://meet.google.com/abc-defg-hij", title: "T", language: "hi", duration: 120 });
  });

  it("vendor errors become clear messages", async () => {
    vi.stubGlobal("fetch", reply(200, { errors: [{ message: "Too many", code: "too_many_requests" }] }, { "retry-after": "300" }));
    await expect(addToLiveMeeting({ meetingLink: "https://x", title: "T", language: "en", durationMin: 60 })).rejects.toMatchObject({ statusCode: 429, message: expect.stringContaining("5 min") });
    vi.stubGlobal("fetch", reply(200, { errors: [{ message: "bad", extensions: { code: "unsupported_platform" } }] }));
    await expect(addToLiveMeeting({ meetingLink: "https://x", title: "T", language: "en", durationMin: 60 })).rejects.toMatchObject({ statusCode: 400 });
    vi.stubGlobal("fetch", reply(401, { errors: [{ message: "Invalid API key" }] }));
    await expect(getTranscript("T1")).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("FIREFLIES_API_KEY") });
    vi.stubGlobal("fetch", reply(200, { data: { transcript: null } }));
    await expect(getTranscript("T1")).rejects.toMatchObject({ statusCode: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    await expect(getTranscript("T1")).rejects.toMatchObject({ statusCode: 502, message: expect.stringContaining("Could not reach") });
  });
});

describe("POST /api/webhooks/fireflies", () => {
  const post = (body: string, sig?: string) => {
    const r = request(app).post("/api/webhooks/fireflies").set("Content-Type", "application/json");
    return (sig ? r.set("X-Hub-Signature", sig) : r).send(body);
  };

  it("needs no team key but rejects unsigned or wrongly signed calls", async () => {
    const body = '{"event":"meeting.transcribed","meeting_id":"M1"}';
    expect((await post(body)).status).toBe(401);
    expect((await post(body, sign(body, "wrong"))).status).toBe(401);
  });

  it("signed events that need no fetch are acknowledged", async () => {
    const body = '{"event":"meeting.bot_joined","meeting_id":"M1","timestamp":1}';
    const r = await post(body, sign(body));
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ received: true, queued: false });
  });

  it("signed but broken payloads -> 400", async () => {
    expect((await post("{not json", sign("{not json"))).status).toBe(400);
    const noId = '{"event":"meeting.transcribed"}';
    expect((await post(noId, sign(noId))).status).toBe(400);
  });
});
