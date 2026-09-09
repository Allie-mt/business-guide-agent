import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import { MILVUS_CLIENT } from "./milvus.provider";

@Injectable()
export class MilvusService implements OnModuleDestroy {
  private readonly logger = new Logger(MilvusService.name);

  constructor(
    @Inject(MILVUS_CLIENT) private readonly client: MilvusClient | null,
  ) {}

  private ensureClient(): MilvusClient {
    if (!this.client) {
      throw new Error(
        "Milvus client is not available. Check Milvus service connection.",
      );
    }
    return this.client;
  }

  async hasCollection(collectionName: string): Promise<boolean> {
    const res = await this.ensureClient().hasCollection({
      collection_name: collectionName,
    });
    return !!res.value;
  }

  async dropCollection(collectionName: string): Promise<void> {
    await this.ensureClient().dropCollection({
      collection_name: collectionName,
    });
  }

  async listCollections(): Promise<string[]> {
    const res = await this.ensureClient().showCollections();
    return res.data.map((c: any) => c.name);
  }

  getClient(): MilvusClient | null {
    return this.client;
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.closeConnection();
      } catch {
        this.logger.warn("Failed to close Milvus connection");
      }
    }
  }
}
