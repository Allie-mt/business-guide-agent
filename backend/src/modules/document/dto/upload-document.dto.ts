import { IsString, IsUUID, IsNotEmpty } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class UploadDocumentDto {
  @ApiProperty({ description: "项目ID" })
  @IsUUID()
  @IsNotEmpty()
  projectId: string;

  @ApiProperty({ description: "文件名" })
  @IsString()
  @IsNotEmpty()
  originalName: string;
}
