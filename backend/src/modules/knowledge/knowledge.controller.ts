import { Controller, Get, Post, Delete, Param, Body } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { KnowledgeService } from "./knowledge.service";
import { CreateKnowledgeBaseDto } from "./dto/knowledge-base.dto";
import { KnowledgeBase } from "./knowledge-base.entity";

@ApiTags("知识库管理")
@ApiBearerAuth()
@Controller("knowledge")
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Post()
  create(@Body() dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    return this.knowledgeService.create(dto);
  }

  @Get("project/:projectId")
  findByProject(
    @Param("projectId") projectId: string,
  ): Promise<KnowledgeBase[]> {
    return this.knowledgeService.findByProject(projectId);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<KnowledgeBase> {
    return this.knowledgeService.findOne(id);
  }

  @Get(":id/graph-stats")
  getGraphStats(@Param("id") id: string): Promise<any> {
    return this.knowledgeService
      .findOne(id)
      .then((kb) => this.knowledgeService.getGraphStats(kb.projectId));
  }

  @Get(":id/vector-stats")
  getVectorStats(@Param("id") id: string): Promise<any> {
    return this.knowledgeService
      .findOne(id)
      .then((kb) => this.knowledgeService.getVectorStats(kb.projectId));
  }

  @Delete(":id")
  remove(@Param("id") id: string): Promise<void> {
    return this.knowledgeService.remove(id);
  }
}
