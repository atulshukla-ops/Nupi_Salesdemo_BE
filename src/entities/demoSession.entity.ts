import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { SessionViewer, TranscriptData, TranscriptStatus } from "../constants/types";

/** One live run of a demo (written by the sync relay in M5; Phase 3 attaches transcripts to it). */
@Entity("T_SDR_Demo_Sessions")
export class DemoSession extends BaseEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id: string;

  @Column({ name: "DemoId", type: "uuid" })
  demoId: string;

  @Column({ name: "PresenterName", type: "varchar", length: 80, nullable: true })
  presenterName: string | null;

  @Column({ name: "StartedAt", type: "timestamptz", default: () => "now()" })
  startedAt: Date;

  @Column({ name: "EndedAt", type: "timestamptz", nullable: true })
  endedAt: Date | null;

  @Column({ name: "PeakViewers", type: "integer", default: 0 })
  peakViewers: number;

  @Column({ name: "Viewers", type: "jsonb", default: () => "'[]'" })
  viewers: SessionViewer[];

  // ---- meeting transcript (notetaker in the Teams / Meet call) ----

  /** The Teams / Google Meet link the notetaker was sent to. */
  @Column({ name: "MeetingLink", type: "varchar", length: 500, nullable: true })
  meetingLink: string | null;

  @Column({ name: "TranscriptStatus", type: "varchar", length: 20, default: "none" })
  transcriptStatus: TranscriptStatus;

  /** 'en' or 'hi' (what the notetaker was told the call is in). */
  @Column({ name: "TranscriptLanguage", type: "varchar", length: 5, nullable: true })
  transcriptLanguage: string | null;

  @Column({ name: "TranscriptRequestedAt", type: "timestamptz", nullable: true })
  transcriptRequestedAt: Date | null;

  /** The notetaker service's id for this meeting's transcript. */
  @Column({ name: "TranscriptVendorId", type: "varchar", length: 100, nullable: true })
  transcriptVendorId: string | null;

  @Column({ name: "TranscriptReadyAt", type: "timestamptz", nullable: true })
  transcriptReadyAt: Date | null;

  @Column({ name: "TranscriptError", type: "varchar", length: 300, nullable: true })
  transcriptError: string | null;

  @Column({ name: "Transcript", type: "jsonb", nullable: true })
  transcript: TranscriptData | null;
}
