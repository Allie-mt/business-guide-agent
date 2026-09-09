import { ChatResponse, BGAWidgetConfig } from "./types";

interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export class ApiClient {
  private baseUrl: string;
  private token?: string;

  constructor(config: BGAWidgetConfig) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async unwrap<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Request failed (${res.status}): ${body}`);
    }
    const json: ApiResponse<T> = await res.json();
    return json.data;
  }

  async createSession(projectId: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/chat/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ projectId }),
    });
    return this.unwrap<{ id: string }>(res);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    imageUrl?: string,
  ): Promise<ChatResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/chat/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sessionId, content, imageUrl }),
    });
    return this.unwrap<ChatResponse>(res);
  }

  async *streamMessage(
    sessionId: string,
    content: string,
    imageUrl?: string,
  ): AsyncGenerator<string> {
    const res = await fetch(`${this.baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sessionId, content, imageUrl }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`streamMessage failed (${res.status}): ${body}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No readable stream");

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        yield data;
      }
    }
  }

  async uploadScreenshot(file: File): Promise<string> {
    const formData = new FormData();
    formData.append("file", file);

    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(
      `${this.baseUrl}/api/v1/documents/upload-screenshot`,
      {
        method: "POST",
        headers,
        body: formData,
      },
    );
    if (!res.ok) throw new Error(`uploadScreenshot failed: ${res.status}`);
    const result = await res.json();
    return result.data?.url ?? result.url;
  }

  async uploadDocument(
    projectId: string,
    file: File,
  ): Promise<{ id: string; originalName: string; ingestStatus: string }> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("projectId", projectId);

    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}/api/v1/documents/upload`, {
      method: "POST",
      headers,
      body: formData,
    });
    return this.unwrap<{
      id: string;
      originalName: string;
      ingestStatus: string;
    }>(res);
  }

  async listDocuments(
    projectId: string,
  ): Promise<
    {
      id: string;
      originalName: string;
      ingestStatus: string;
      chunkCount?: number;
      createdAt: string;
    }[]
  > {
    const res = await fetch(
      `${this.baseUrl}/api/v1/documents/project/${projectId}`,
      {
        headers: this.headers(),
      },
    );
    return this.unwrap<
      {
        id: string;
        originalName: string;
        ingestStatus: string;
        chunkCount?: number;
        createdAt: string;
      }[]
    >(res);
  }

  async triggerIngest(
    documentId: string,
  ): Promise<{ id: string; ingestStatus: string }> {
    const res = await fetch(
      `${this.baseUrl}/api/v1/documents/${documentId}/ingest`,
      {
        method: "POST",
        headers: this.headers(),
      },
    );
    return this.unwrap<{ id: string; ingestStatus: string }>(res);
  }
}
