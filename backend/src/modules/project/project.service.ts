import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Project } from "./project.entity";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
  ) {}

  async create(dto: CreateProjectDto): Promise<Project> {
    const project = this.projectRepo.create({
      ...dto,
      milvusCollectionName: `bga_${dto.name.replace(/\s+/g, "_").toLowerCase()}`,
      neo4jLabel: dto.name.replace(/\s+/g, "_").toUpperCase(),
    });
    return this.projectRepo.save(project);
  }

  async findAll(): Promise<Project[]> {
    return this.projectRepo.find({ order: { createdAt: "DESC" } });
  }

  async findOne(id: string): Promise<Project> {
    return this.projectRepo.findOneByOrFail({ id });
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Project> {
    await this.projectRepo.update(id, dto);
    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.projectRepo.delete(id);
  }
}
