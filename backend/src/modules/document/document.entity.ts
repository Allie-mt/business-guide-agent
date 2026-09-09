import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Project } from "../project/project.entity";

@Entity("documents")
export class Document {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, { onDelete: "CASCADE" })
  @JoinColumn({ name: "projectId" })
  project: Project;

  @Column()
  originalName: string;

  @Column()
  storageKey: string;

  @Column()
  mimeType: string;

  @Column()
  fileSize: number;

  @Column({ default: 0 })
  chunkCount: number;

  @Column({ default: "pending" })
  ingestStatus: "pending" | "processing" | "completed" | "failed";

  @Column({ nullable: true })
  ingestError: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
