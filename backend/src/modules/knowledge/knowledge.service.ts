import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { KnowledgeBase } from "./knowledge-base.entity";
import { CreateKnowledgeBaseDto } from "./dto/knowledge-base.dto";
import { Neo4jService } from "../../infrastructure/neo4j/neo4j.service";
import { MilvusService } from "../../infrastructure/milvus/milvus.service";

@Injectable()
export class KnowledgeService {
  constructor(
    @InjectRepository(KnowledgeBase)
    private readonly kbRepo: Repository<KnowledgeBase>,
    private readonly neo4jService: Neo4jService,
    private readonly milvusService: MilvusService,
  ) {}

  async create(dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
    const kb = this.kbRepo.create(dto);
    return this.kbRepo.save(kb);
  }

  async findByProject(projectId: string): Promise<KnowledgeBase[]> {
    return this.kbRepo.find({
      where: { projectId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: string): Promise<KnowledgeBase> {
    const kb = await this.kbRepo.findOneBy({ id });
    if (!kb) throw new NotFoundException(`知识库 ${id} 不存在`);
    return kb;
  }

  async updateStats(
    id: string,
    documentCount?: number,
    entityCount?: number,
  ): Promise<KnowledgeBase> {
    const updateData: Partial<KnowledgeBase> = {};
    if (documentCount !== undefined) updateData.documentCount = documentCount;
    if (entityCount !== undefined) updateData.entityCount = entityCount;
    await this.kbRepo.update(id, updateData);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.kbRepo.delete(id);
  }

  async getGraphStats(projectId: string): Promise<any> {
    const result = await this.neo4jService.run(
      `MATCH (e:Entity {project_id: $projectId})
       RETURN labels(e) AS labels, count(e) AS count
       ORDER BY count DESC`,
      { projectId },
    );
    return result;
  }

  async getVectorStats(projectId: string): Promise<any> {
    const collectionName = `bga_${projectId}`;
    if (!this.milvusService.isAvailable()) {
      return {
        collectionName,
        exists: false,
        entityCount: 0,
        available: false,
      };
    }
    const exists = await this.milvusService.hasCollection(collectionName);
    if (!exists) {
      return { collectionName, exists: false, entityCount: 0 };
    }
    const client = this.milvusService.getClient()!;
    const stats = await client.getCollectionStatistics({
      collection_name: collectionName,
    });
    return {
      collectionName,
      exists: true,
      entityCount: stats.data.row_count,
    };
  }
}
