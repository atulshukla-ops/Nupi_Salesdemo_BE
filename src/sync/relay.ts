import { IncomingMessage, Server } from "http";
import { Duplex } from "stream";
import { IsNull } from "typeorm";
import { RawData, WebSocket, WebSocketServer } from "ws";
import env from "../configs/env";
import { SessionViewer } from "../constants/types";
import { Demo } from "../entities/demo.entity";
import logger from "../utils/logger";
import { verifyHostToken } from "./hostToken";
import { endSession, openSession, saveSessionViewers } from "./sessions";

/**
 * Live sync relay — replaces the free PeerJS broker.
 *
 *   console  --(wss /sync?role=host&slug=…&token=…)-->  relay  <--(wss /sync?role=viewer&slug=…)--  viewers
 *
 * It carries the frontend's existing messages unchanged (src/sync/protocol.ts):
 *   host  -> viewers : { t: "state", … }        broadcast to every viewer of the demo
 *   host  -> viewer  : { t: "pong", viewerId }  only to that viewer (clock sync)
 *   viewer -> host   : { t: "hello" | "ping" }  only to the console
 * plus relay notices { t: "relay", event } so the frontend can show connection status.
 * Viewers can never send anything to other viewers. One console per demo.
 */

export const CLOSE = {
  badRequest: 4000,
  unauthorized: 4001,
  full: 4003,
  notFound: 4004,
  taken: 4009,
  replaced: 4010
} as const;

const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_MS = 30_000;
const FLUSH_MS = 10_000;
const VIEWER_MAX_MSGS_PER_SEC = 20;
const VIEWER_STATUSES = new Set(["waiting", "watching", "buffering", "paused"]);

interface Client {
  ws: WebSocket;
  role: "host" | "viewer";
  viewerId?: string;
  alive: boolean;
  windowStart: number;
  windowCount: number;
}

interface Room {
  slug: string;
  demoId: string;
  host: Client | null;
  viewers: Set<Client>;
  sessionId: string | null;
  sessionOpening: Promise<void> | null;
  endTimer: NodeJS.Timeout | null;
  seen: Map<string, SessionViewer>;
  peak: number;
  dirty: boolean;
}

const rooms = new Map<string, Room>();
const clients = new Set<Client>();

const send = (client: Client, msg: unknown) => {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(typeof msg === "string" ? msg : JSON.stringify(msg));
};
const notice = (event: string, extra: Record<string, unknown> = {}) => ({ t: "relay", event, ...extra });

const getRoom = (slug: string, demoId: string) => {
  let room = rooms.get(slug);
  if (!room) {
    room = { slug, demoId, host: null, viewers: new Set(), sessionId: null, sessionOpening: null, endTimer: null, seen: new Map(), peak: 0, dirty: false };
    rooms.set(slug, room);
  }
  return room;
};

const dropRoomIfIdle = (room: Room) => {
  if (!room.host && room.viewers.size === 0 && !room.sessionId && !room.sessionOpening) rooms.delete(room.slug);
};

// ---------- sessions ----------

const ensureSession = async (room: Room, presenterName: string | null) => {
  if (room.sessionId) return;
  if (!room.sessionOpening) {
    room.sessionOpening = openSession(room.demoId, presenterName)
      .then((s) => {
        room.sessionId = s.id;
        room.dirty = room.seen.size > 0; // viewers who were already waiting
        logger.info(`Live session ${s.id} started for demo ${room.slug}`);
      })
      .finally(() => (room.sessionOpening = null));
  }
  await room.sessionOpening;
};

const endRoomSession = async (room: Room) => {
  room.endTimer = null;
  if (room.host || !room.sessionId) return;
  const sessionId = room.sessionId;
  room.sessionId = null;
  await endSession(sessionId, [...room.seen.values()], room.peak).catch((e) => logger.error(`Could not end session ${sessionId}: ${e.message}`));
  logger.info(`Live session ${sessionId} ended for demo ${room.slug} (${room.seen.size} viewer(s), peak ${room.peak})`);
  room.seen = new Map();
  room.peak = 0;
  room.dirty = false;
  dropRoomIfIdle(room);
};

const flushViewers = async () => {
  for (const room of rooms.values()) {
    if (!room.dirty || !room.sessionId) continue;
    room.dirty = false;
    await saveSessionViewers(room.sessionId, [...room.seen.values()], room.peak).catch((e) => {
      room.dirty = true;
      logger.error(`Could not save viewers for ${room.slug}: ${e.message}`);
    });
  }
};

// ---------- messages ----------

const parse = (data: RawData, isBinary: boolean): Record<string, unknown> | null => {
  if (isBinary) return null;
  try {
    const msg = JSON.parse(data.toString());
    return msg && typeof msg === "object" && typeof msg.t === "string" ? msg : null;
  } catch {
    return null;
  }
};

const fromHost = (room: Room, raw: string, msg: Record<string, unknown>) => {
  if (msg.t === "state") {
    for (const v of room.viewers) send(v, raw);
  } else if (msg.t === "pong" && typeof msg.viewerId === "string") {
    for (const v of room.viewers) if (v.viewerId === msg.viewerId) send(v, raw);
  }
};

const fromViewer = (room: Room, client: Client, msg: Record<string, unknown>) => {
  const now = Date.now();
  if (now - client.windowStart >= 1000) {
    client.windowStart = now;
    client.windowCount = 0;
  }
  if (++client.windowCount > VIEWER_MAX_MSGS_PER_SEC) return; // flooding: drop

  if ((msg.t !== "hello" && msg.t !== "ping") || typeof msg.viewerId !== "string" || !/^[\w-]{1,64}$/.test(msg.viewerId)) return;
  // A connection speaks for one viewer only, so nobody can pose as another viewer.
  if (!client.viewerId) client.viewerId = msg.viewerId;
  else if (client.viewerId !== msg.viewerId) return;

  let forward: Record<string, unknown>;
  if (msg.t === "hello") {
    const name = typeof msg.name === "string" ? msg.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) : "";
    const status = typeof msg.status === "string" && VIEWER_STATUSES.has(msg.status) ? msg.status : "waiting";
    const drift = typeof msg.drift === "number" && Number.isFinite(msg.drift) ? msg.drift : 0;
    forward = { t: "hello", viewerId: msg.viewerId, name, status, drift };

    const at = new Date(now).toISOString();
    const known = room.seen.get(msg.viewerId);
    if (!known || known.name !== name || now - new Date(known.lastSeenAt).getTime() > FLUSH_MS) room.dirty = true;
    room.seen.set(msg.viewerId, { viewerId: msg.viewerId, name, firstSeenAt: known?.firstSeenAt ?? at, lastSeenAt: at });
  } else {
    if (typeof msg.t0 !== "number") return;
    forward = { t: "ping", viewerId: msg.viewerId, t0: msg.t0 };
  }
  if (room.host) send(room.host, forward);
};

// ---------- connections ----------

type Early = { data: RawData; isBinary: boolean }[];

const onConnection = async (ws: WebSocket, url: URL, early: Early) => {
  const slug = url.searchParams.get("slug") ?? "";
  const role = url.searchParams.get("role");
  if (!/^[a-z0-9-]{1,160}$/.test(slug) || (role !== "host" && role !== "viewer")) {
    return ws.close(CLOSE.badRequest, "slug and role=host|viewer are required");
  }

  const demo = await Demo.findOneBy({ slug, isTemplate: false, deletedAt: IsNull() });
  if (!demo) return ws.close(CLOSE.notFound, "This demo link is not valid");

  let claims = null;
  if (role === "host") {
    claims = verifyHostToken(url.searchParams.get("token") ?? "", slug);
    if (!claims || claims.sub !== demo.id) return ws.close(CLOSE.unauthorized, "Invalid or expired host token");
  }
  if (ws.readyState !== WebSocket.OPEN) return; // client left during the checks

  const room = getRoom(slug, demo.id);
  const client: Client = { ws, role, alive: true, windowStart: Date.now(), windowCount: 0 };

  if (role === "host") {
    const current = room.host;
    if (current && current.ws.readyState === WebSocket.OPEN) {
      if (url.searchParams.get("takeover") !== "1") {
        send(client, notice("taken"));
        return ws.close(CLOSE.taken, "This demo is already open in another console");
      }
      room.host = null; // so the old console's close does not announce "host offline"
      send(current, notice("replaced"));
      current.ws.close(CLOSE.replaced, "Opened in another console");
    }
    room.host = client;
    if (room.endTimer) clearTimeout(room.endTimer);
    room.endTimer = null;
  } else {
    if (room.viewers.size >= env.syncMaxViewers) {
      dropRoomIfIdle(room);
      return ws.close(CLOSE.full, "This demo has reached its viewer limit");
    }
    room.viewers.add(client);
    room.peak = Math.max(room.peak, room.viewers.size);
    room.dirty = true;
    send(client, notice("joined", { hostOnline: !!room.host }));
  }

  // Handlers go on before anything else is awaited, so a connection that drops in the meantime
  // is still cleaned up (and the heartbeat can see it).
  clients.add(client);
  ws.on("pong", () => (client.alive = true));
  const onMessage = (data: RawData, isBinary: boolean) => {
    const msg = parse(data, isBinary);
    if (!msg) return;
    if (client.role === "host") {
      if (room.host === client) fromHost(room, data.toString(), msg);
    } else fromViewer(room, client, msg);
  };
  // Messages that arrived while the demo was being looked up (clients send right after "open").
  ws.removeAllListeners("message");
  ws.on("message", onMessage);
  for (const m of early.splice(0)) onMessage(m.data, m.isBinary);
  ws.on("close", () => {
    clients.delete(client);
    if (client.role === "host") {
      if (room.host !== client) return; // replaced by a takeover
      room.host = null;
      for (const v of room.viewers) send(v, notice("host-offline"));
      // Keep the session open for a while: the console is often just reconnecting.
      room.endTimer = setTimeout(() => void endRoomSession(room), env.syncHostGraceSec * 1000);
    } else {
      room.viewers.delete(client);
      const seen = client.viewerId && room.seen.get(client.viewerId);
      if (seen) {
        seen.lastSeenAt = new Date().toISOString();
        room.dirty = true;
      }
      dropRoomIfIdle(room);
    }
  });

  if (role === "host") {
    await ensureSession(room, claims!.name).catch((e) => logger.error(`Could not start session for ${slug}: ${e.message}`));
    if (room.host === client && ws.readyState === WebSocket.OPEN) {
      send(client, notice("ready", { viewers: room.viewers.size }));
      for (const v of room.viewers) send(v, notice("host-online"));
    } else if (!room.host && !room.endTimer) {
      // The console left while the session was being created and its grace period already ran out.
      void endRoomSession(room);
    }
  }
};

/** Attaches the relay to the API's HTTP server at /sync. */
export const attachRelay = (server: Server) => {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? "/", "http://relay");
    if (url.pathname !== "/sync") return socket.destroy();
    // Browsers always send Origin; only our frontend may connect from a browser.
    const origin = req.headers.origin;
    if (origin && !env.corsOrigins.includes(origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Listen immediately: anything sent before the connection is set up is queued (max 50), not lost.
      const early: Early = [];
      ws.on("message", (data, isBinary) => {
        if (early.length < 50) early.push({ data, isBinary });
      });
      ws.on("error", () => undefined);
      onConnection(ws, url, early).catch((e) => {
        logger.error(`Relay connection error: ${e instanceof Error ? e.message : e}`);
        ws.close(1011, "Server error");
      });
    });
  });

  // Drop connections that stopped answering (laptop asleep, network gone).
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);
  const flush = setInterval(() => void flushViewers(), FLUSH_MS);
  wss.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(flush);
  });

  logger.info("Live sync relay ready at /sync");
  return wss;
};
