import neo4j from "neo4j-driver";
import { Logger } from "@nestjs/common";

export const NEO4J_DRIVER = "NEO4J_DRIVER";

export const neo4jProvider = {
  provide: NEO4J_DRIVER,
  useFactory: () => {
    const logger = new Logger("Neo4jProvider");
    const uri = process.env.NEO4J_URI || "bolt://localhost:7687";
    const user = process.env.NEO4J_USER || "neo4j";
    const password = process.env.NEO4J_PASSWORD || "";

    try {
      const driver = neo4j.driver(uri, neo4j.auth.basic(user, password), {
        connectionAcquisitionTimeout: 5000,
      });
      logger.log(`Neo4j driver created for ${uri} (lazy connect)`);
      return driver;
    } catch (err) {
      logger.warn(
        `Neo4j driver creation failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  },
};
