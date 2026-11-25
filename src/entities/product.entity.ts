import { BaseEntity, Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

/** A product line in the shared library (the frontend's "tab": NUPI, IRIS, MANDI…). */
@Entity("T_SDR_Products")
export class Product extends BaseEntity {
  @PrimaryGeneratedColumn("uuid", { name: "Id" })
  id: string;

  @Column({ name: "Name", type: "varchar", length: 40 })
  name: string;

  /** One line shown to clients on the welcome agenda and product card. */
  @Column({ name: "Description", type: "varchar", length: 200, default: "" })
  description: string;

  @Column({ name: "Color", type: "varchar", length: 9, default: "#AFDAE1" })
  color: string;

  /** Guidance for the presenter about this product (never shown to clients). */
  @Column({ name: "TalkingPoints", type: "text", default: "" })
  talkingPoints: string;

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

  @Column({ name: "ArchivedAt", type: "timestamptz", nullable: true })
  archivedAt: Date | null;
}
