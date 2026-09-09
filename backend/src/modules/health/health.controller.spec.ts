import { Test, TestingModule } from "@nestjs/testing";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  it("check() should return ok status", () => {
    const result = controller.check();
    expect(result.status).toBe("ok");
    expect(result.service).toBe("business-guide-agent-backend");
    expect(result.version).toBe("0.1.0");
    expect(result.timestamp).toBeDefined();
  });

  it("ready() should return ready status", () => {
    const result = controller.ready();
    expect(result.status).toBe("ready");
    expect(result.timestamp).toBeDefined();
  });
});
