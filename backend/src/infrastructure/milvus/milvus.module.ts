import { Module } from "@nestjs/common";
import { milvusProvider, MILVUS_CLIENT } from "./milvus.provider";
import { MilvusService } from "./milvus.service";

@Module({
  providers: [milvusProvider, MilvusService],
  exports: [MilvusService, MILVUS_CLIENT],
})
export class MilvusModule {}
