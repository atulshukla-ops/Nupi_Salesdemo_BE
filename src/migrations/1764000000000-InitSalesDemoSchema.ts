import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Phase 1 schema: the 5 Sales Demo Room tables.
 * Hand-written SQL so every statement can be reviewed before it is run.
 * Needs PostgreSQL 13+ (gen_random_uuid() is built in).
 */
export class InitSalesDemoSchema1764000000000 implements MigrationInterface {
  name = "InitSalesDemoSchema1764000000000";

  public async up(q: QueryRunner): Promise<void> {
    // 1. Workspace settings — exactly one row
    await q.query(`
      CREATE TABLE "T_SDR_Workspace_Settings" (
        "Id"        smallint     PRIMARY KEY DEFAULT 1 CHECK ("Id" = 1),
        "AboutText" text         NOT NULL DEFAULT '',
        "Pillars"   jsonb        NOT NULL DEFAULT '[]',
        "UpdatedBy" varchar(80),
        "UpdatedAt" timestamptz  NOT NULL DEFAULT now()
      )`);
    // Seed with the same defaults the frontend ships with today (src/lib/db.ts DEFAULT_SETTINGS)
    await q.query(
      `INSERT INTO "T_SDR_Workspace_Settings" ("Id", "AboutText", "Pillars") VALUES (1, $1, $2::jsonb)`,
      [
        "NupiPay builds loyalty, rewards and commerce platforms that help brands grow with their channel partners — from the first scan to the final payout.",
        JSON.stringify([
          { title: "Loyalty that scales", text: "Programs for retailers, dealers and influencers, launched in weeks." },
          { title: "Insight in real time", text: "Every scan, order and reward, measured as it happens." },
          { title: "Commerce built in", text: "A partner storefront with orders, delivery and payouts in one place." }
        ])
      ]
    );

    // 2. Products (the frontend's "tabs")
    await q.query(`
      CREATE TABLE "T_SDR_Products" (
        "Id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "Name"          varchar(40)  NOT NULL,
        "Description"   varchar(200) NOT NULL DEFAULT '',
        "Color"         varchar(9)   NOT NULL DEFAULT '#AFDAE1',
        "TalkingPoints" text         NOT NULL DEFAULT '',
        "SortOrder"     integer      NOT NULL DEFAULT 0,
        "CreatedBy"     varchar(80),
        "UpdatedBy"     varchar(80),
        "CreatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "UpdatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "ArchivedAt"    timestamptz
      )`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_SDR_Products_ActiveName" ON "T_SDR_Products" (lower("Name")) WHERE "ArchivedAt" IS NULL`
    );

    // 3. Assets (videos now, decks in Phase 2); the upload in progress lives in "PendingUpload"
    await q.query(`
      CREATE TABLE "T_SDR_Assets" (
        "Id"               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "ProductId"        uuid         NOT NULL REFERENCES "T_SDR_Products" ("Id") ON DELETE RESTRICT,
        "Kind"             varchar(10)  NOT NULL DEFAULT 'video' CHECK ("Kind" IN ('video', 'deck')),
        "Title"            varchar(120) NOT NULL,
        "Description"      varchar(300) NOT NULL DEFAULT '',
        "Notes"            text         NOT NULL DEFAULT '',
        "Status"           varchar(12)  NOT NULL DEFAULT 'uploading'
                                        CHECK ("Status" IN ('uploading', 'processing', 'ready', 'failed')),
        "FailureReason"    text,
        "Version"          integer      NOT NULL DEFAULT 0,
        "PlaybackKey"      varchar(500),
        "ThumbnailKey"     varchar(500),
        "OriginalFileName" varchar(255),
        "MimeType"         varchar(100),
        "SizeBytes"        bigint,
        "DurationSec"      numeric(10,2),
        "Width"            integer,
        "Height"           integer,
        "PendingUpload"    jsonb,
        "SortOrder"        integer      NOT NULL DEFAULT 0,
        "CreatedBy"        varchar(80),
        "UpdatedBy"        varchar(80),
        "CreatedAt"        timestamptz  NOT NULL DEFAULT now(),
        "UpdatedAt"        timestamptz  NOT NULL DEFAULT now(),
        "ReplacedAt"       timestamptz,
        "DeletedAt"        timestamptz
      )`);
    await q.query(
      `CREATE INDEX "IX_SDR_Assets_ProductSort" ON "T_SDR_Assets" ("ProductId", "SortOrder") WHERE "DeletedAt" IS NULL`
    );

    // 4. Demos: client demos and Standard Flows (IsTemplate = true)
    await q.query(`
      CREATE TABLE "T_SDR_Demos" (
        "Id"            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
        "IsTemplate"    boolean      NOT NULL DEFAULT false,
        "FlowId"        uuid         REFERENCES "T_SDR_Demos" ("Id") ON DELETE SET NULL,
        "Name"          varchar(120) NOT NULL,
        "ClientName"    varchar(120) NOT NULL DEFAULT '',
        "DemoDate"      date,
        "Slug"          varchar(160),
        "Audience"      varchar(120) NOT NULL DEFAULT '',
        "Description"   text         NOT NULL DEFAULT '',
        "IsRecommended" boolean      NOT NULL DEFAULT false,
        "Welcome"       jsonb        NOT NULL,
        "Options"       jsonb        NOT NULL,
        "RunOfShow"     jsonb        NOT NULL DEFAULT '[]',
        "CreatedBy"     varchar(80),
        "UpdatedBy"     varchar(80),
        "CreatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "UpdatedAt"     timestamptz  NOT NULL DEFAULT now(),
        "LastLiveAt"    timestamptz,
        "DeletedAt"     timestamptz,
        CONSTRAINT "CK_SDR_Demos_ClientDemoFields"
          CHECK ("IsTemplate" OR ("Slug" IS NOT NULL AND "DemoDate" IS NOT NULL))
      )`);
    // Slugs stay reserved even after a demo is deleted, so an old invite link never points at a new demo.
    await q.query(`CREATE UNIQUE INDEX "UQ_SDR_Demos_Slug" ON "T_SDR_Demos" ("Slug") WHERE "Slug" IS NOT NULL`);
    await q.query(
      `CREATE INDEX "IX_SDR_Demos_List" ON "T_SDR_Demos" ("IsTemplate", "CreatedAt" DESC) WHERE "DeletedAt" IS NULL`
    );
    // Speeds up "where is this asset used?" checks (RunOfShow @> ...)
    await q.query(`CREATE INDEX "IX_SDR_Demos_RunOfShow" ON "T_SDR_Demos" USING gin ("RunOfShow" jsonb_path_ops)`);

    // 5. Live sessions (viewer list kept on the row)
    await q.query(`
      CREATE TABLE "T_SDR_Demo_Sessions" (
        "Id"            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "DemoId"        uuid        NOT NULL REFERENCES "T_SDR_Demos" ("Id") ON DELETE CASCADE,
        "PresenterName" varchar(80),
        "StartedAt"     timestamptz NOT NULL DEFAULT now(),
        "EndedAt"       timestamptz,
        "PeakViewers"   integer     NOT NULL DEFAULT 0,
        "Viewers"       jsonb       NOT NULL DEFAULT '[]'
      )`);
    await q.query(`CREATE INDEX "IX_SDR_DemoSessions_Demo" ON "T_SDR_Demo_Sessions" ("DemoId", "StartedAt" DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "T_SDR_Demo_Sessions"`);
    await q.query(`DROP TABLE IF EXISTS "T_SDR_Demos"`);
    await q.query(`DROP TABLE IF EXISTS "T_SDR_Assets"`);
    await q.query(`DROP TABLE IF EXISTS "T_SDR_Products"`);
    await q.query(`DROP TABLE IF EXISTS "T_SDR_Workspace_Settings"`);
  }
}
