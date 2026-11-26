import PgBoss from "pg-boss";
import AppDataSource from "./configs/database";
import env from "./configs/env";
import { QUEUES, startBoss, stopBoss } from "./jobs/boss";
import { runMaintenance } from "./services/maintenance.service";
import { fetchAndSaveTranscript } from "./services/transcript.service";
import AppError from "./utils/appError";
import { markProcessingFailed, processVideo } from "./services/videoProcessing.service";
import { PermanentVideoError } from "./utils/ffmpeg";
import logger from "./utils/logger";

/**
 * Background worker: video and deck processing + nightly maintenance.
 * Runs as its own process (npm run dev:worker / npm run start:worker) so a long ffmpeg job
 * never slows down the API.
 */
type VideoJob = PgBoss.JobWithMetadata<{ assetId: string; version: number }>;

const handleVideoJob = async (job: VideoJob) => {
  const { assetId, version } = job.data;
  try {
    await processVideo(assetId, version);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof PermanentVideoError) {
      // Retrying cannot fix a file that is not a usable video: tell the user now.
      await markProcessingFailed(assetId, version, message);
      return;
    }
    if (job.retryCount >= job.retryLimit) {
      await markProcessingFailed(assetId, version, "This file could not be processed. Please upload it again.");
      logger.error(`File ${assetId} v${version} failed after ${job.retryCount + 1} attempts: ${message}`);
      return;
    }
    logger.warn(`File ${assetId} v${version} attempt ${job.retryCount + 1} failed, will retry: ${message}`);
    throw error; // pg-boss retries with backoff
  }
};

const start = async () => {
  await AppDataSource.initialize();
  logger.info("Worker: Database Connected");
  const boss = await startBoss("worker");

  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY) || 1);
  for (let i = 0; i < concurrency; i++) {
    await boss.work<{ assetId: string; version: number }>(
      QUEUES.videoProcess,
      { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 2 },
      async ([job]) => handleVideoJob(job)
    );
  }

  // Finished meeting transcripts (queued by the notetaker's webhook).
  await boss.work<{ meetingId: string }>(QUEUES.transcriptFetch, { includeMetadata: true, batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
    try {
      await fetchAndSaveTranscript(job.data.meetingId);
    } catch (error) {
      const status = error instanceof AppError ? error.statusCode : 500;
      // A missing key or a bad request will not fix itself; anything else (busy, not ready yet, network) is retried.
      if (status === 400 || status === 503) {
        logger.error(`Transcript ${job.data.meetingId} could not be fetched: ${(error as Error).message}`);
        return;
      }
      logger.warn(`Transcript ${job.data.meetingId} attempt ${job.retryCount + 1} failed, will retry: ${(error as Error).message}`);
      throw error;
    }
  });

  await boss.work(QUEUES.maintenance, { batchSize: 1 }, async () => {
    await runMaintenance();
  });
  // Every night at 02:00 India time, like be-admin-portal's crons.
  await boss.schedule(QUEUES.maintenance, "0 2 * * *", {}, { tz: "Asia/Kolkata" });

  logger.info(`Worker ready (${concurrency} video job(s) at a time, ${env.nodeEnv})`);
};

const shutdown = async (signal: string) => {
  logger.info(`Worker stopping (${signal})`);
  await stopBoss();
  await AppDataSource.destroy().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

start().catch((error) => {
  logger.error(`Worker cannot start: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
