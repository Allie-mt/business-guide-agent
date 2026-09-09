import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { ChatSession } from "./chat-session.entity";

@Entity("chat_messages")
export class ChatMessage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => ChatSession, { onDelete: "CASCADE" })
  @JoinColumn({ name: "sessionId" })
  session: ChatSession;

  @Column({ type: "enum", enum: ["user", "assistant"] })
  role: "user" | "assistant";

  @Column("text")
  content: string;

  @Column("simple-json", { nullable: true })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;
}
