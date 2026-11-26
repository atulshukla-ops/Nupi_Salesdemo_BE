import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Meeting transcription (Phase 3): a notetaker (Fireflies.ai) joins the Teams / Google Meet call
 * and its transcript is attached to the live session of the demo.
 *  - T_SDR_Demos.MeetingLink: the call link the presenter pasted (kept for the next session).
 *  - T_SDR_Demo_Sessions: the link used, transcript status, the vendor's id and the transcript itself.
 */
export class AddTranscripts1766000000000 implements MigrationInterface {
  name = "AddTranscripts1766000000000";

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "T_SDR_Demos" ADD COLUMN IF NOT EXISTS "MeetingLink" varchar(500) NULL`);
    await q.query(`
      ALTER TABLE "T_SDR_Demo_Sessions"
        ADD COLUMN IF NOT EXISTS "MeetingLink" varchar(500) NULL,
        ADD COLUMN IF NOT EXISTS "TranscriptStatus" varchar(20) NOT NULL DEFAULT 'none'
          CHECK ("TranscriptStatus" IN ('none', 'requested', 'ready', 'failed')),
        ADD COLUMN IF NOT EXISTS "TranscriptLanguage" varchar(5) NULL,
        ADD COLUMN IF NOT EXISTS "TranscriptRequestedAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "TranscriptVendorId" varchar(100) NULL,
        ADD COLUMN IF NOT EXISTS "TranscriptReadyAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "TranscriptError" varchar(300) NULL,
        ADD COLUMN IF NOT EXISTS "Transcript" jsonb NULL`);
    // One vendor transcript belongs to one session.
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_SDR_Sessions_TranscriptVendorId" ON "T_SDR_Demo_Sessions" ("TranscriptVendorId") WHERE "TranscriptVendorId" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "UQ_SDR_Sessions_TranscriptVendorId"`);
    await q.query(`
      ALTER TABLE "T_SDR_Demo_Sessions"
        DROP COLUMN IF EXISTS "Transcript",
        DROP COLUMN IF EXISTS "TranscriptError",
        DROP COLUMN IF EXISTS "TranscriptReadyAt",
        DROP COLUMN IF EXISTS "TranscriptVendorId",
        DROP COLUMN IF EXISTS "TranscriptRequestedAt",
        DROP COLUMN IF EXISTS "TranscriptLanguage",
        DROP COLUMN IF EXISTS "TranscriptStatus",
        DROP COLUMN IF EXISTS "MeetingLink"`);
    await q.query(`ALTER TABLE "T_SDR_Demos" DROP COLUMN IF EXISTS "MeetingLink"`);
  }
}
