import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;
  private available = false;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379", 10),
      password: process.env.REDIS_PASSWORD || undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => {
        if (times > 3) {
          this.logger.warn("Redis: max retries reached, giving up");
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.client.on("error", (err) => {
      if (!this.available) return;
      this.logger.warn(`Redis error: ${err.message}`);
    });

    this.client.on("connect", () => {
      this.available = true;
      this.logger.log("Redis connected");
    });

    this.client.connect().catch((err) => {
      this.logger.warn(
        `Redis connection failed: ${err.message}. Caching features will be disabled.`,
      );
    });
  }

  isAvailable(): boolean {
    return this.available;
  }

  async get(key: string): Promise<string | null> {
    if (!this.available) return null;
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.available) return;
    if (ttlSeconds) {
      await this.client.set(key, value, "EX", ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.available) return;
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    if (!this.available) return false;
    const result = await this.client.exists(key);
    return result === 1;
  }

  getClient(): Redis {
    return this.client;
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }
}
