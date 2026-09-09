import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import { Logger } from "@nestjs/common";

export const MILVUS_CLIENT = "MILVUS_CLIENT";

export const milvusProvider = {
  provide: MILVUS_CLIENT,
  useFactory: async () => {
    const logger = new Logger("MilvusProvider");
    const address = `${process.env.MILVUS_HOST || "localhost"}:${process.env.MILVUS_PORT || 19530}`;

    try {
      const client = new MilvusClient({
        address,
        timeout: 3000,
      });
      await client.checkHealth();
      logger.log(`Milvus connected at ${address}`);
      return client;
    } catch (err) {
      logger.warn(
        `Milvus not available at ${address}: ${err instanceof Error ? err.message : err}. Service will run in degraded mode.`,
      );
      return null;
    }
  },
};
