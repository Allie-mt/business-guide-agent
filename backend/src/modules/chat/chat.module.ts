import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChatSession } from "./chat-session.entity";
import { ChatMessage } from "./chat-message.entity";
import { ChatService } from "./chat.service";
import { ChatController } from "./chat.controller";

@Module({
  imports: [TypeOrmModule.forFeature([ChatSession, ChatMessage])],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
