import { IsString, IsOptional, IsBoolean, IsObject } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UpdateProjectDto {
  @ApiProperty({ description: "项目名称", required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ description: "项目描述", required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: "是否启用", required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: "项目配置", required: false })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}
