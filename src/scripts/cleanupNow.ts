import AppDataSource from "../configs/database";
import { startBoss, stopBoss } from "../jobs/boss";
import { runMaintenance } from "../services/maintenance.service";
import logger from "../utils/logger";

/** Runs the nightly maintenance once, right now (npm run cleanup:now). */
(async () => {
  await AppDataSource.initialize();
  await startBoss("api"); // needed to re-queue stuck videos
  const report = await runMaintenance();
  console.log(JSON.stringify(report, null, 2));
  await stopBoss();
  await AppDataSource.destroy();
})().catch((error) => {
  logger.error(`Cleanup failed: ${error instanceof Error ? error.stack : String(error)}`);
  process.exit(1);
});
