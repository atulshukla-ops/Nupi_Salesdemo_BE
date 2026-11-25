import PgBoss from "pg-boss";
import env from "../configs/env";
import logger from "../utils/logger";

/**
 * pg-boss job queue, stored in the same database in its own "pgboss" schema
 * (pg-boss creates and upgrades that schema itself on first start).
 */
export const QUEUES = {
  videoProcess: "video-process",
  maintenance: "maintenance-cleanup"
} as const;

let boss: PgBoss | null = null;

/**
 * @param role "api" only sends jobs; "worker" also runs pg-boss maintenance and cron schedules.
 */
export const startBoss = async (role: "api" | "worker") => {
  if (boss) return boss;
  const instance = new PgBoss({
    host: env.dbHost,
    port: env.dbPort,
    user: env.dbUserName,
    password: env.dbPassword,
    database: env.dbName,
    schema: "pgboss",
    application_name: `sales-demo-${role}`,
    max: role === "worker" ? 5 : 3,
    supervise: role === "worker",
    schedule: role === "worker"
  });
  instance.on("error", (error) => logger.error(`Job queue error: ${error.message}`));
  await instance.start();
  await instance.createQueue(QUEUES.videoProcess, {
    name: QUEUES.videoProcess,
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 4 * 60 * 60 // long transcodes
  });
  await instance.createQueue(QUEUES.maintenance, { name: QUEUES.maintenance, retryLimit: 1, expireInSeconds: 60 * 60 });
  boss = instance;
  logger.info(`Job queue started (${role})`);
  return boss;
};

export const getBoss = () => {
  if (!boss) throw new Error("Job queue not started");
  return boss;
};

export const stopBoss = async () => {
  if (boss) await boss.stop({ graceful: true, timeout: 30_000 });
  boss = null;
};

/** Queues processing of one uploaded file version. The singleton key prevents duplicate jobs. */
export const enqueueVideoProcessing = (assetId: string, version: number) =>
  getBoss().send(QUEUES.videoProcess, { assetId, version }, { singletonKey: `${assetId}:v${version}` });
