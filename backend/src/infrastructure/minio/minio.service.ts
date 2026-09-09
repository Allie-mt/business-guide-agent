import * as Minio from "minio";
import * as stream from "stream";
import { Injectable, Logger, OnModuleInit } from "@nestjs/common";

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private client: Minio.Client | null = null;
  private bucket: string;
  private available = false;

  onModuleInit() {
    const endpoint = process.env.MINIO_ENDPOINT || "localhost:9000";
    const [host, portStr] = endpoint.split(":");
    const port = parseInt(portStr, 10) || 9000;

    this.bucket = process.env.MINIO_BUCKET || "business-guide-agent";

    try {
      this.client = new Minio.Client({
        endPoint: host,
        port,
        useSSL: process.env.MINIO_USE_SSL === "true",
        accessKey: process.env.MINIO_ACCESS_KEY || "minioadmin",
        secretKey: process.env.MINIO_SECRET_KEY || "minioadmin",
      });
      this._ensureBucket();
      this.available = true;
      this.logger.log(`MinIO client created for ${endpoint}`);
    } catch (err) {
      this.logger.warn(
        `MinIO not available at ${endpoint}: ${err instanceof Error ? err.message : err}. Upload features will be disabled.`,
      );
      this.available = false;
    }
  }

  private async _ensureBucket() {
    if (!this.client) return;
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to ensure bucket ${this.bucket}: ${err instanceof Error ? err.message : err}`,
      );
      this.available = false;
    }
  }

  isAvailable(): boolean {
    return this.available && this.client !== null;
  }

  private ensureClient(): Minio.Client {
    if (!this.client || !this.available) {
      throw new Error(
        "MinIO is not available. Check MinIO service connection.",
      );
    }
    return this.client;
  }

  async upload(
    objectName: string,
    data: Buffer | stream.Readable,
    size: number,
    mimeType: string,
  ): Promise<string> {
    const metadata = { "Content-Type": mimeType };
    await this.ensureClient().putObject(
      this.bucket,
      objectName,
      data,
      size,
      metadata,
    );
    return objectName;
  }

  async download(objectName: string): Promise<Buffer> {
    const s = await this.ensureClient().getObject(this.bucket, objectName);
    const chunks: Buffer[] = [];
    for await (const chunk of s as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async delete(objectName: string): Promise<void> {
    await this.ensureClient().removeObject(this.bucket, objectName);
  }

  async getPresignedUrl(
    objectName: string,
    expirySeconds = 3600,
  ): Promise<string> {
    return this.ensureClient().presignedGetObject(
      this.bucket,
      objectName,
      expirySeconds,
    );
  }

  getClient(): Minio.Client | null {
    return this.client;
  }
}
