import { Controller, Get, Post, Param, Body, Res } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { Response } from "express";
import { ChatService } from "./chat.service";
import { CreateSessionDto, SendMessageDto } from "./dto/chat.dto";
import { ChatSession } from "./chat-session.entity";
import { ChatMessage } from "./chat-message.entity";

@ApiTags("会话管理")
@ApiBearerAuth()
@Controller("chat")
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post("sessions")
  @ApiOperation({ summary: "创建会话" })
  createSession(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    return this.chatService.createSession(dto);
  }

  @Get("sessions/project/:projectId")
  @ApiOperation({ summary: "获取项目下所有会话" })
  findSessionsByProject(
    @Param("projectId") projectId: string,
  ): Promise<ChatSession[]> {
    return this.chatService.findSessionsByProject(projectId);
  }

  @Get("sessions/:sessionId/messages")
  @ApiOperation({ summary: "获取会话消息列表" })
  findMessages(@Param("sessionId") sessionId: string): Promise<ChatMessage[]> {
    return this.chatService.findMessagesBySession(sessionId);
  }

  @Post("messages")
  @ApiOperation({ summary: "发送消息（非流式）" })
  sendMessage(@Body() dto: SendMessageDto): Promise<ChatMessage> {
    return this.chatService.sendMessage(dto);
  }

  @Post("stream")
  @ApiOperation({ summary: "流式对话（SSE）" })
  async streamMessages(
    @Body() dto: SendMessageDto,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendSse = (data: string) => {
      res.write(`data: ${data}\n\n`);
      const raw = res as unknown as { flush?: () => void };
      if (typeof raw.flush === "function") raw.flush();
    };

    try {
      const session = await this.chatService.findSession(dto.sessionId);
      if (!session) {
        sendSse(
          JSON.stringify({
            type: "error",
            content: `会话 ${dto.sessionId} 不存在`,
          }),
        );
        res.end();
        return;
      }

      const userMessage = await this.chatService.saveMessage({
        sessionId: dto.sessionId,
        role: "user",
        content: dto.content,
      });
      sendSse(
        JSON.stringify({
          type: "user_message",
          id: userMessage.id,
          content: userMessage.content,
        }),
      );

      for await (const chunk of this.chatService.streamMessage(
        session.projectId,
        dto.content,
        dto.imageUrl,
      )) {
        sendSse(chunk);
      }

      sendSse("[DONE]");
      res.end();
    } catch (err) {
      sendSse(
        JSON.stringify({ type: "error", content: (err as Error).message }),
      );
      res.end();
    }
  }
}
