import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { KnowledgeBase } from "./knowledge-base.entity";
import { KnowledgeService } from "./knowledge.service";
import { KnowledgeController } from "./knowledge.controller";

@Module({
  imports: [TypeOrmModule.forFeature([KnowledgeBase])],
  controllers: [KnowledgeController],
  providers: [KnowledgeService],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
