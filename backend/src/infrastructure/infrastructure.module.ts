import { Module, Global } from "@nestjs/common";
import { MilvusModule } from "./milvus/milvus.module";
import { Neo4jModule } from "./neo4j/neo4j.module";
import { RedisModule } from "./redis/redis.module";
import { MinioModule } from "./minio/minio.module";

@Global()
@Module({
  imports: [MilvusModule, Neo4jModule, RedisModule, MinioModule],
  exports: [MilvusModule, Neo4jModule, RedisModule, MinioModule],
})
export class InfrastructureModule {}
