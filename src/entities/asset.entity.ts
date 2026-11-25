import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { AssetKind, AssetStatus, PendingUpload } from "../constants/types";
import { numberTransformer } from "./transformers";

/**
 * A piece of demo content: a video now, a deck (PPT/PDF) in Phase 2.
 * The upload in progress (new file or replacement) is kept on the row in PendingUpload.
 */
@Entity("T_SDR_Assets")
export class Asset extends BaseEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id: string;

  @Column({ name: "ProductId", type: "uuid" })
  productId: string;

  @Column({ name: "Kind", type: "varchar", length: 10, default: "video" })
  kind: AssetKind;

  @Column({ name: "Title", type: "varchar", length: 120 })
  title: string;

  /** Shown to clients on the lower-third when the video starts. */
  @Column({ name: "Description", type: "varchar", length: 300, default: "" })
  description: string;

  /** Presenter-only speaker notes. */
  @Column({ name: "Notes", type: "text", default: "" })
  notes: string;

  @Column({ name: "Status", type: "varchar", length: 12, default: "uploading" })
  status: AssetStatus;

  @Column({ name: "FailureReason", type: "text", nullable: true })
  failureReason: string | null;

  /** Version of the file currently playable (0 = nothing playable yet). */
  @Column({ name: "Version", type: "integer", default: 0 })
  version: number;

  @Column({ name: "PlaybackKey", type: "varchar", length: 500, nullable: true })
  playbackKey: string | null;

  @Column({ name: "ThumbnailKey", type: "varchar", length: 500, nullable: true })
  thumbnailKey: string | null;

  @Column({ name: "OriginalFileName", type: "varchar", length: 255, nullable: true })
  originalFileName: string | null;

  @Column({ name: "MimeType", type: "varchar", length: 100, nullable: true })
  mimeType: string | null;

  @Column({ name: "SizeBytes", type: "bigint", nullable: true, transformer: numberTransformer })
  sizeBytes: number | null;

  @Column({ name: "DurationSec", type: "numeric", precision: 10, scale: 2, nullable: true, transformer: numberTransformer })
  durationSec: number | null;

  @Column({ name: "Width", type: "integer", nullable: true })
  width: number | null;

  @Column({ name: "Height", type: "integer", nullable: true })
  height: number | null;

  @Column({ name: "PendingUpload", type: "jsonb", nullable: true })
  pendingUpload: PendingUpload | null;

  @Column({ name: "SortOrder", type: "integer", default: 0 })
  sortOrder: number;

  @Column({ name: "CreatedBy", type: "varchar", length: 80, nullable: true })
  createdBy: string | null;

  @Column({ name: "UpdatedBy", type: "varchar", length: 80, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "CreatedAt", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "UpdatedAt", type: "timestamptz" })
  updatedAt: Date;

  @Column({ name: "ReplacedAt", type: "timestamptz", nullable: true })
  replacedAt: Date | null;

  @Column({ name: "DeletedAt", type: "timestamptz", nullable: true })
  deletedAt: Date | null;
}
