import { Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import neo4j, { Driver, Session } from "neo4j-driver";
import { NEO4J_DRIVER } from "./neo4j.provider";

@Injectable()
export class Neo4jService implements OnModuleDestroy {
  private readonly logger = new Logger(Neo4jService.name);

  constructor(@Inject(NEO4J_DRIVER) private readonly driver: Driver | null) {}

  private ensureDriver(): Driver {
    if (!this.driver) {
      throw new Error(
        "Neo4j driver is not available. Check Neo4j service connection.",
      );
    }
    return this.driver;
  }

  getSession(): Session {
    return this.ensureDriver().session({
      database: process.env.NEO4J_DATABASE || "neo4j",
    });
  }

  async run(cypher: string, params?: Record<string, any>): Promise<any[]> {
    const session = this.getSession();
    try {
      const result = await session.run(cypher, params);
      return result.records.map((record) => record.toObject());
    } finally {
      await session.close();
    }
  }

  isAvailable(): boolean {
    return this.driver !== null;
  }

  async onModuleDestroy() {
    if (this.driver) {
      try {
        await this.driver.close();
      } catch {
        this.logger.warn("Failed to close Neo4j connection");
      }
    }
  }
}
