import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Decks (PPT/PDF) are stored as assets of kind 'deck' (already allowed by the Kind check).
 * The only new thing they need is how many slides they have.
 */
export class AddDeckSlideCount1765000000000 implements MigrationInterface {
  name = "AddDeckSlideCount1765000000000";

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "T_SDR_Assets" ADD COLUMN IF NOT EXISTS "SlideCount" integer NULL CHECK ("SlideCount" IS NULL OR "SlideCount" > 0)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "T_SDR_Assets" DROP COLUMN IF EXISTS "SlideCount"`);
  }
}
