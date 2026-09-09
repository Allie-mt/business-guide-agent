import {
  IsUUID,
  IsString,
  IsOptional,
  IsEnum,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateSessionDto {
  @ApiProperty({ description: "项目ID" })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: "用户ID", required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ description: "会话标题", required: false })
  @IsOptional()
  @IsString()
  title?: string;
}

export class SendMessageDto {
  @ApiProperty({ description: "会话ID" })
  @IsUUID()
  @IsNotEmpty()
  sessionId: string;

  @ApiProperty({ description: "用户消息内容" })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({ description: "截图URL", required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;
}
