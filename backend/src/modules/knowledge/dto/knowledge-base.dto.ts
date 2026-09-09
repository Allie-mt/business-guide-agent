import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateKnowledgeBaseDto {
  @ApiProperty({ description: "项目ID" })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: "知识库名称" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: "知识库描述", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: "知识库类型",
    enum: ["vector", "graph", "hybrid"],
    required: false,
  })
  @IsOptional()
  @IsEnum(["vector", "graph", "hybrid"])
  type?: "vector" | "graph" | "hybrid";
}
