import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ChatSession } from "./chat-session.entity";
import { ChatMessage } from "./chat-message.entity";
import { CreateSessionDto, SendMessageDto } from "./dto/chat.dto";
import { RedisService } from "../../infrastructure/redis/redis.service";

const getAgentServiceUrl = () =>
  process.env.AGENT_SERVICE_URL || "http://localhost:8000";

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly redisService: RedisService,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<ChatSession> {
    const session = this.sessionRepo.create(dto);
    return this.sessionRepo.save(session);
  }

  async findSessionsByProject(projectId: string): Promise<ChatSession[]> {
    return this.sessionRepo.find({
      where: { projectId },
      order: { createdAt: "DESC" },
    });
  }

  async findMessagesBySession(sessionId: string): Promise<ChatMessage[]> {
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: "ASC" },
    });
  }

  async findSession(sessionId: string): Promise<ChatSession | null> {
    return this.sessionRepo.findOneBy({ id: sessionId });
  }

  async saveMessage(partial: Partial<ChatMessage>): Promise<ChatMessage> {
    const message = this.messageRepo.create(partial);
    return this.messageRepo.save(message);
  }

  async sendMessage(dto: SendMessageDto): Promise<ChatMessage> {
    const session = await this.sessionRepo.findOneBy({ id: dto.sessionId });
    if (!session) throw new NotFoundException(`会话 ${dto.sessionId} 不存在`);

    const userMessage = this.messageRepo.create({
      sessionId: dto.sessionId,
      role: "user",
      content: dto.content,
    });
    await this.messageRepo.save(userMessage);

    const agentResponse = await this._callAgentService(
      session.projectId,
      dto.content,
      dto.imageUrl,
    );

    const assistantMessage = this.messageRepo.create({
      sessionId: dto.sessionId,
      role: "assistant",
      content: agentResponse.answer,
      metadata: {
        intent: agentResponse.intent,
        retrievalStrategy: agentResponse.retrieval_strategy,
        citations: agentResponse.citations,
        hallucinationScore: agentResponse.hallucination_score,
        hallucinationPassed: agentResponse.hallucination_passed,
      },
    });
    return this.messageRepo.save(assistantMessage);
  }

  private async _callAgentService(
    projectId: string,
    query: string,
    imageUrl?: string,
  ): Promise<any> {
    const cacheKey = `chat:cache:${projectId}:${query}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    const response = await fetch(`${getAgentServiceUrl()}/api/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        query,
        image_url: imageUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent Service 调用失败: ${error}`);
    }

    const result = await response.json();
    await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async *streamMessage(
    projectId: string,
    query: string,
    imageUrl?: string,
  ): AsyncGenerator<string> {
    const response = await fetch(`${getAgentServiceUrl()}/api/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        project_id: projectId,
        query,
        image_url: imageUrl,
      }),
    });

    if (!response.ok) {
      throw new Error(`Agent Service stream failed: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No readable stream");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        yield data;
      }
    }
  }
}
