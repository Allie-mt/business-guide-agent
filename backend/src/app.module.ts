import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectModule } from "./modules/project/project.module";
import { DocumentModule } from "./modules/document/document.module";
import { ChatModule } from "./modules/chat/chat.module";
import { KnowledgeModule } from "./modules/knowledge/knowledge.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../.env", ".env"] }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: "postgres" as const,
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
        username: process.env.POSTGRES_USER || "postgres",
        password: process.env.POSTGRES_PASSWORD || "postgres",
        database: process.env.POSTGRES_DB || "business_guide_agent",
        autoLoadEntities: true,
        synchronize: process.env.NODE_ENV === "development",
        logging: process.env.NODE_ENV === "development",
      }),
    }),
    InfrastructureModule,
    AuthModule,
    ProjectModule,
    DocumentModule,
    ChatModule,
    KnowledgeModule,
    HealthModule,
  ],
})
export class AppModule {}
