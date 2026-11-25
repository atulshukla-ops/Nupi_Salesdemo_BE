import dotenv from "dotenv";

/**
 * Initialize environment variables.
 */
dotenv.config();

const num = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// The env variables that are used by the api
export default {
  // app
  nodeEnv: process.env.NODE_ENV || "development",
  port: num(process.env.PORT, 8130),
  /** Address browsers use to reach this API (used in locally signed storage URLs). */
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || `http://localhost:${num(process.env.PORT, 8130)}`).replace(/\/+$/, ""),
  corsOrigins: list(process.env.CORS_ORIGINS),
  /**
   * Number of proxies (nginx, load balancer) in front of the API. Needed so rate limits and logs
   * see the real client address instead of the proxy's. 0 = connected directly (local).
   */
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
  /** Swagger UI at /api-docs. On by default except in production. */
  apiDocs: (process.env.API_DOCS ?? (process.env.NODE_ENV === "production" ? "false" : "true")) === "true",

  // access
  teamKey: process.env.TEAM_KEY || "",
  hostTokenSecret: process.env.HOST_TOKEN_SECRET || "",

  // database
  dbHost: process.env.DB_HOST,
  dbPort: num(process.env.DB_PORT, 5432),
  dbUserName: process.env.DB_USERNAME,
  dbPassword: process.env.DB_PASSWORD,
  dbName: process.env.DB_NAME,
  dbSchema: process.env.DB_SCHEMA || "public",

  // storage
  storageDriver: (process.env.STORAGE_DRIVER || "local") as "local" | "s3",
  localStorageDir: process.env.LOCAL_STORAGE_DIR || "./storage",
  storagePrefix: process.env.STORAGE_PREFIX || "sales-demo",
  awsRegion: process.env.AWS_REGION || "ap-south-1",
  s3Bucket: process.env.S3_BUCKET || "",

  // uploads & playback
  maxUploadBytes: num(process.env.MAX_UPLOAD_BYTES, 2 * 1024 * 1024 * 1024),
  uploadPartBytes: num(process.env.UPLOAD_PART_BYTES, 16 * 1024 * 1024),
  playbackUrlTtlSec: num(process.env.PLAYBACK_URL_TTL_SEC, 4 * 60 * 60),

  // live sync relay
  /** How long a session stays open after the console disconnects (it may just be reconnecting). */
  syncHostGraceSec: num(process.env.SYNC_HOST_GRACE_SEC, 5 * 60),
  syncMaxViewers: num(process.env.SYNC_MAX_VIEWERS, 50),
  hostTokenTtlSec: num(process.env.HOST_TOKEN_TTL_SEC, 12 * 60 * 60),

  // housekeeping
  trashRetentionDays: num(process.env.TRASH_RETENTION_DAYS, 30),
  uploadAbandonHours: Number(process.env.UPLOAD_ABANDON_HOURS ?? 24),
  processingRequeueMinutes: Number(process.env.PROCESSING_REQUEUE_MINUTES ?? 60)
};
