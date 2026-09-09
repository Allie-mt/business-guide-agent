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

@Entity("knowledge_bases")
export class KnowledgeBase {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, { onDelete: "CASCADE" })
  @JoinColumn({ name: "projectId" })
  project: Project;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ default: "vector" })
  type: "vector" | "graph" | "hybrid";

  @Column({ default: 0 })
  documentCount: number;

  @Column({ default: 0 })
  entityCount: number;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
