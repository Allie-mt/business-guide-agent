import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation } from "@nestjs/swagger";

@ApiTags("系统")
@Controller("health")
export class HealthController {
  @Get()
  @ApiOperation({ summary: "健康检查" })
  check(): Record<string, any> {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      service: "business-guide-agent-backend",
      version: "0.1.0",
    };
  }

  @Get("ready")
  @ApiOperation({ summary: "就绪检查" })
  ready(): Record<string, any> {
    return {
      status: "ready",
      timestamp: new Date().toISOString(),
    };
  }
}
