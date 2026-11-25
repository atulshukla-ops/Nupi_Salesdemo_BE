import { createServer } from "http";
import app from "./app";
import AppDataSource from "./configs/database";
import env from "./configs/env";
import { startBoss, stopBoss } from "./jobs/boss";
import { attachRelay } from "./sync/relay";
import { closeStaleSessions } from "./sync/sessions";
import logger from "./utils/logger";

/** Refuse to start with settings that would leave the API open or broken. */
const checkConfig = () => {
  const problems: string[] = [];
  if (env.teamKey.length < 16) problems.push("TEAM_KEY must be set (at least 16 characters)");
  if (env.hostTokenSecret.length < 32) problems.push("HOST_TOKEN_SECRET must be set (at least 32 characters)");
  if (!env.dbName || !env.dbUserName) problems.push("DB_NAME and DB_USERNAME must be set");
  if (env.storageDriver !== "local" && env.storageDriver !== "s3") problems.push('STORAGE_DRIVER must be "local" or "s3"');
  if (env.storageDriver === "s3" && !env.s3Bucket) problems.push("S3_BUCKET must be set when STORAGE_DRIVER=s3");
  if (env.storageDriver === "s3" && !env.storagePrefix) problems.push("STORAGE_PREFIX must be set (the bucket is shared)");
  const cf = [env.cloudfrontDomain, env.cloudfrontKeyPairId, env.cloudfrontPrivateKey].filter(Boolean).length;
  if (cf > 0 && cf < 3) problems.push("CLOUDFRONT_DOMAIN, CLOUDFRONT_KEY_PAIR_ID and CLOUDFRONT_PRIVATE_KEY must be set together");
  if (!env.corsOrigins.length) logger.warn("CORS_ORIGINS is empty: browsers will not be able to call the API");
  if (problems.length) {
    problems.forEach((p) => logger.error(`Config: ${p}`));
    process.exit(1);
  }
};

const start = async () => {
  checkConfig();
  await AppDataSource.initialize();
  logger.info("Database Connected");

  const pending = await AppDataSource.showMigrations();
  if (pending) logger.warn("There are database migrations that have not been run yet (npm run migration:show)");

  // The API only sends jobs (e.g. "process this upload"); the worker process runs them.
  await startBoss("api");

  const closed = await closeStaleSessions();
  if (closed) logger.info(`Closed ${closed} live session(s) left open by a previous run`);

  const server = createServer(app);
  const relay = attachRelay(server); // live sync WebSocket at /sync
  server.listen(env.port, () => {
    logger.info(`Sales Demo Room API listening on port ${env.port} (${env.nodeEnv})`);
  });

  // Deploys / restarts (docker stop sends SIGTERM): finish open requests, tell live consoles and
  // viewers to reconnect (1012 = service restart; the frontend retries), then close cleanly.
  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, shutting down`);
    setTimeout(() => process.exit(0), 10_000).unref(); // never hang a deploy
    for (const ws of relay.clients) ws.close(1012, "Server restarting");
    relay.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await stopBoss().catch(() => undefined);
    await AppDataSource.destroy().catch(() => undefined);
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
};

start().catch((error) => {
  logger.error(`Cannot start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

process
  .on("unhandledRejection", (reason) => {
    logger.error(`Unhandled Rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  })
  .on("uncaughtException", (err) => {
    logger.error(`Uncaught Exception: ${err.stack || err.message}`);
    process.exit(1);
  });
