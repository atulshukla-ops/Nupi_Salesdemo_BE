import { BaseEntity, Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { Pillar } from "../constants/types";

/** Single row (Id = 1): the "About NupiPay" text and highlights every client sees on the welcome screen. */
@Entity("T_SDR_Workspace_Settings")
export class WorkspaceSettings extends BaseEntity {
  @PrimaryColumn({ name: "Id", type: "smallint" })
  id: number;

  @Column({ name: "AboutText", type: "text", default: "" })
  aboutText: string;

  @Column({ name: "Pillars", type: "jsonb", default: () => "'[]'" })
  pillars: Pillar[];

  @Column({ name: "UpdatedBy", type: "varchar", length: 80, nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: "UpdatedAt", type: "timestamptz" })
  updatedAt: Date;
}
