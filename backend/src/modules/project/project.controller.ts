import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { ProjectService } from "./project.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { Project } from "./project.entity";

@ApiTags("项目管理")
@ApiBearerAuth()
@Controller("projects")
export class ProjectController {
  constructor(private readonly projectService: ProjectService) {}

  @Post()
  create(@Body() dto: CreateProjectDto): Promise<Project> {
    return this.projectService.create(dto);
  }

  @Get()
  findAll(): Promise<Project[]> {
    return this.projectService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string): Promise<Project> {
    return this.projectService.findOne(id);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<Project> {
    return this.projectService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string): Promise<void> {
    return this.projectService.remove(id);
  }
}
