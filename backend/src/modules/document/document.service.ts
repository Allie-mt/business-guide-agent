import { Injectable, NotFoundException, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Document } from "./document.entity";
import { RedisService } from "../../infrastructure/redis/redis.service";
import { MinioService } from "../../infrastructure/minio/minio.service";

const getAgentServiceUrl = () =>
  process.env.AGENT_SERVICE_URL || "http://localhost:8000";

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(Document)
    private readonly docRepo: Repository<Document>,
    private readonly redisService: RedisService,
    private readonly minioService: MinioService,
  ) {}

  async uploadAndCreate(
    projectId: string,
    originalName: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<Document> {
    const safeName = originalName.replace(/[^\w\u4e00-\u9fff.-]/g, "_");
    const storageKey = `projects/${projectId}/documents/${Date.now()}_${safeName}`;

    await this.minioService.upload(
      storageKey,
      fileBuffer,
      fileBuffer.length,
      mimeType,
    );

    const doc = this.docRepo.create({
      projectId,
      originalName,
      storageKey,
      mimeType,
      fileSize: fileBuffer.length,
      ingestStatus: "pending",
    });
    const saved = await this.docRepo.save(doc);

    this._triggerIngestAsync(saved).catch((err) =>
      this.logger.warn(`自动摄取触发失败，已入队等待: ${err.message}`),
    );

    return saved;
  }

  async findByProject(projectId: string): Promise<Document[]> {
    return this.docRepo.find({
      where: { projectId },
      order: { createdAt: "DESC" },
    });
  }

  async findOne(id: string): Promise<Document> {
    const doc = await this.docRepo.findOneBy({ id });
    if (!doc) throw new NotFoundException(`文档 ${id} 不存在`);
    return doc;
  }

  async getDownloadUrl(id: string): Promise<string> {
    const doc = await this.findOne(id);
    return this.minioService.getPresignedUrl(doc.storageKey);
  }

  async updateIngestStatus(
    id: string,
    status: Document["ingestStatus"],
    error?: string,
    chunkCount?: number,
  ): Promise<Document> {
    const updateData: Partial<Document> = { ingestStatus: status };
    if (error) updateData.ingestError = error;
    if (chunkCount !== undefined) updateData.chunkCount = chunkCount;
    await this.docRepo.update(id, updateData);
    return this.findOne(id);
  }

  async triggerIngest(id: string): Promise<Document> {
    const doc = await this.findOne(id);
    if (doc.ingestStatus === "completed") {
      return doc;
    }

    await this.updateIngestStatus(id, "processing");

    try {
      const downloadUrl = await this.minioService.getPresignedUrl(
        doc.storageKey,
      );
      const response = await fetch(
        `${getAgentServiceUrl()}/api/v1/ingest/pipeline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: doc.projectId,
            file_url: downloadUrl,
            document_id: doc.id,
            mime_type: doc.mimeType,
            original_name: doc.originalName,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Agent Service 摄取失败: ${errorText}`);
      }

      const result = await response.json();
      const chunkCount =
        result.vector?.total_chunks || result.graph?.entity_count || 0;

      return this.updateIngestStatus(id, "completed", undefined, chunkCount);
    } catch (err) {
      this.logger.error(`文档摄取失败: ${(err as Error).message}`);
      await this.updateIngestStatus(id, "failed", (err as Error).message);
      throw err;
    }
  }

  async remove(id: string): Promise<void> {
    const doc = await this.findOne(id);
    await this.minioService.delete(doc.storageKey).catch(() => {});
    await this.docRepo.delete(id);
  }

  async uploadScreenshot(
    storageKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.minioService.upload(storageKey, buffer, buffer.length, mimeType);
  }

  async getScreenshotUrl(storageKey: string): Promise<string> {
    return this.minioService.getPresignedUrl(storageKey);
  }

  private async _triggerIngestAsync(doc: Document): Promise<void> {
    await this.updateIngestStatus(doc.id, "processing");

    try {
      const downloadUrl = await this.minioService.getPresignedUrl(
        doc.storageKey,
      );
      const response = await fetch(
        `${getAgentServiceUrl()}/api/v1/ingest/pipeline`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_id: doc.projectId,
            file_url: downloadUrl,
            document_id: doc.id,
            mime_type: doc.mimeType,
            original_name: doc.originalName,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Agent Service 摄取失败: ${errorText}`);
      }

      const result = await response.json();
      const chunkCount =
        result.vector?.total_chunks || result.graph?.entity_count || 0;

      await this.updateIngestStatus(doc.id, "completed", undefined, chunkCount);
    } catch (err) {
      this.logger.error(`自动摄取失败: ${(err as Error).message}`);
      await this.updateIngestStatus(doc.id, "failed", (err as Error).message);
    }
  }
}
