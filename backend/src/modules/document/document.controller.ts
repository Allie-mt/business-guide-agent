import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  Res,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
} from "@nestjs/swagger";
import { DocumentService } from "./document.service";
import { Document } from "./document.entity";
import { Response } from "express";

@ApiTags("文档管理")
@ApiBearerAuth()
@Controller("documents")
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post("upload")
  @ApiOperation({ summary: "上传文档到项目" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body("projectId") projectId: string,
  ): Promise<Document> {
    return this.documentService.uploadAndCreate(
      projectId,
      file.originalname,
      file.buffer,
      file.mimetype,
    );
  }

  @Post("upload-screenshot")
  @ApiOperation({ summary: "上传截图（用于多模态对话）" })
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(FileInterceptor("file"))
  async uploadScreenshot(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    const storageKey = `screenshots/${Date.now()}_${file.originalname}`;
    await this.documentService.uploadScreenshot(
      storageKey,
      file.buffer,
      file.mimetype,
    );
    const url = await this.documentService.getScreenshotUrl(storageKey);
    return { url };
  }

  @Get("project/:projectId")
  findByProject(@Param("projectId") projectId: string): Promise<Document[]> {
    return this.documentService.findByProject(projectId);
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<Document> {
    return this.documentService.findOne(id);
  }

  @Get(":id/download")
  async download(@Param("id") id: string, @Res() res: Response) {
    const url = await this.documentService.getDownloadUrl(id);
    res.redirect(url);
  }

  @Post(":id/ingest")
  @ApiOperation({ summary: "手动触发文档摄取" })
  triggerIngest(@Param("id") id: string): Promise<Document> {
    return this.documentService.triggerIngest(id);
  }

  @Delete(":id")
  @ApiOperation({ summary: "删除文档" })
  remove(@Param("id") id: string): Promise<void> {
    return this.documentService.remove(id);
  }
}
