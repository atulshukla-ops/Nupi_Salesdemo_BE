import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { DemoOptions, DemoWelcome, RunOfShow } from "../constants/types";

/**
 * A client demo (IsTemplate = false: has a client, a date and an invite slug)
 * or a Standard Flow (IsTemplate = true: a reusable run of show, no slug).
 */
@Entity("T_SDR_Demos")
export class Demo extends BaseEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id: string;

  @Column({ name: "IsTemplate", type: "boolean", default: false })
  isTemplate: boolean;

  /** For client demos: the Standard Flow it was created from, if any. */
  @Column({ name: "FlowId", type: "uuid", nullable: true })
  flowId: string | null;

  @Column({ name: "Name", type: "varchar", length: 120 })
  name: string;

  @Column({ name: "ClientName", type: "varchar", length: 120, default: "" })
  clientName: string;

  /** YYYY-MM-DD (client demos only). */
  @Column({ name: "DemoDate", type: "date", nullable: true })
  demoDate: string | null;

  /** Invite link slug (client demos only), e.g. 2026-11-24-acme-retail-product-walkthrough-k7f2. */
  @Column({ name: "Slug", type: "varchar", length: 160, nullable: true })
  slug: string | null;

  /** Standard Flows only: who the flow is for, e.g. "Retail brands". */
  @Column({ name: "Audience", type: "varchar", length: 120, default: "" })
  audience: string;

  @Column({ name: "Description", type: "text", default: "" })
  description: string;

  @Column({ name: "IsRecommended", type: "boolean", default: false })
  isRecommended: boolean;

  @Column({ name: "Welcome", type: "jsonb" })
  welcome: DemoWelcome;

  @Column({ name: "Options", type: "jsonb" })
  options: DemoOptions;

  @Column({ name: "RunOfShow", type: "jsonb", default: () => "'[]'" })
  runOfShow: RunOfShow;

  @Column({ name: "CreatedBy", type: "varchar", length: 80, nullable: true })
  createdBy: string | null;

  @Column({ name: "UpdatedBy", type: "varchar", length: 80, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: "CreatedAt", type: "timestamptz" })
  createdAt: Date;

  @UpdateDateColumn({ name: "UpdatedAt", type: "timestamptz" })
  updatedAt: Date;

  @Column({ name: "LastLiveAt", type: "timestamptz", nullable: true })
  lastLiveAt: Date | null;

  @Column({ name: "DeletedAt", type: "timestamptz", nullable: true })
  deletedAt: Date | null;
}
