import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { SessionViewer } from "../constants/types";

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
}
