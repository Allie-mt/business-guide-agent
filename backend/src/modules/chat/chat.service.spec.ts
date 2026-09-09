import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ChatService } from "./chat.service";
import { ChatSession } from "./chat-session.entity";
import { ChatMessage } from "./chat-message.entity";
import { RedisService } from "../../infrastructure/redis/redis.service";

describe("ChatService", () => {
  let service: ChatService;

  const mockSessionRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

  const mockMessageRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        { provide: getRepositoryToken(ChatSession), useValue: mockSessionRepo },
        { provide: getRepositoryToken(ChatMessage), useValue: mockMessageRepo },
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("createSession", () => {
    it("should create and save a session", async () => {
      const dto = { projectId: "test-project" };
      const session = { id: "session-1", ...dto };
      mockSessionRepo.create.mockReturnValue(session);
      mockSessionRepo.save.mockResolvedValue(session);

      const result = await service.createSession(dto);
      expect(mockSessionRepo.create).toHaveBeenCalledWith(dto);
      expect(mockSessionRepo.save).toHaveBeenCalledWith(session);
      expect(result).toEqual(session);
    });
  });

  describe("findSession", () => {
    it("should return session when found", async () => {
      const session = { id: "session-1", projectId: "p1" };
      mockSessionRepo.findOneBy.mockResolvedValue(session);

      const result = await service.findSession("session-1");
      expect(result).toEqual(session);
    });

    it("should return null when not found", async () => {
      mockSessionRepo.findOneBy.mockResolvedValue(null);
      const result = await service.findSession("nonexistent");
      expect(result).toBeNull();
    });
  });
});
