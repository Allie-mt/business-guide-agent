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

@Entity("chat_sessions")
export class ChatSession {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, { onDelete: "CASCADE" })
  @JoinColumn({ name: "projectId" })
  project: Project;

  @Column({ nullable: true })
  userId: string;

  @Column({ nullable: true })
  title: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
