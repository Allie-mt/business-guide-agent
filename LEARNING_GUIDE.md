# Business Guide Agent — 学习指南

> 本文档按 **由浅入深、逐层拆解** 的方式组织，帮助你从零开始理解整个项目的实现细节。
> 每个章节包含：**架构定位 → 代码导读 → 关键知识点 → 动手练习**

---

## 目录

- [第一层：全局架构认知](#第一层全局架构认知)
- [第二层：前端（Vue 3）](#第二层前端vue-3)
- [第三层：后端（NestJS）](#第三层后端nestjs)
- [第四层：Agent 引擎（LangGraph）⭐ 核心](#第四层agent-引擎langgraph-核心)
- [第五层：检索与摄取](#第五层检索与摄取)
- [第六层：Prompt 工程与安全](#第六层prompt-工程与安全)
- [第七层：基础设施与数据存储](#第七层基础设施与数据存储)
- [附录：核心概念速查](#附录核心概念速查)

---

## 第一层：全局架构认知

### 1.1 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                      用户浏览器                              │
│  ┌──────────────┐              ┌──────────────┐             │
│  │  ChatWidget   │              │  Admin Panel │             │
│  │  (对话组件)    │              │  (管理后台)   │             │
│  └───────┬───────┘              └──────┬───────┘             │
└──────────┼─────────────────────────────┼─────────────────────┘
           │ HTTP / SSE                  │ HTTP
           ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  Backend (NestJS :3000)                      │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐         │
│  │  Chat   │ │ Project │ │Document │ │ Knowledge│         │
│  │ Module  │ │ Module  │ │ Module  │ │ Module   │         │
│  └────┬────┘ └─────────┘ └────┬────┘ └──────────┘         │
│       │ HTTP                       │ HTTP                   │
└───────┼────────────────────────────┼────────────────────────┘
        ▼                            ▼
┌──────────────────────┐  ┌──────────────────────────────────┐
│  Agent Service        │  │  Infrastructure                  │
│  (FastAPI :8000)      │  │  PostgreSQL │ Redis │ MinIO      │
│  ┌────────────────┐  │  │  Milvus     │ Neo4j              │
│  │  LangGraph      │  │  └──────────────────────────────────┘
│  │  Workflow       │  │
│  │  ┌──────────┐  │  │
│  │  │ 8 Nodes  │  │  │
│  │  └──────────┘  │  │
│  └────────────────┘  │
└──────────────────────┘
```

### 1.2 请求流转（一次对话的完整生命周期）

```
用户输入 "如何新建客户？"
    │
    ▼
[前端] ChatWidget.vue → handleSend()
    │  1. 添加 user 消息到 messages
    │  2. 调用 client.createSession() 获取 sessionId
    │  3. 调用 client.streamMessage() 发起 SSE 请求
    ▼
[后端] ChatController → streamMessages()
    │  1. 验证 sessionId 存在
    │  2. 保存 user 消息到 PostgreSQL
    │  3. 转发请求到 Agent Service
    │  4. 逐块读取 SSE 流，透传给前端
    ▼
[Agent] routes.py → /api/v1/chat/stream
    │  1. sanitize_input() 清洗输入
    │  2. check_injection() 检测 Prompt 注入
    │  3. 构建 AgentState 初始状态
    │  4. 调用 agent_app.astream() 执行 LangGraph 工作流
    ▼
[LangGraph 工作流执行]
    │
    ▼ vision_preprocess → (如有截图) 调用多模态 LLM 分析
    ▼ intent_recognition → LLM 识别意图 → "operation_guide"
    ▼ retrieval_router → 意图映射策略 → "hybrid"
    ▼ vector_retrieval → Milvus 语义检索 → [文档片段...]
    ▼ graph_retrieval → Neo4j 图谱查询 → [实体关系...]
    ▼ context_combiner → 合并双通道上下文
    ▼ answer_generation → LLM 基于上下文生成回答
    ▼ hallucination_check → LLM 审核回答是否幻觉
    │
    ▼
[Agent] 逐节点 yield SSE 事件
    │
    ▼
[后端] 透传 SSE → [前端] 逐块解析 → 实时渲染回答
```

### 1.3 文档摄取流转

```
用户上传 PDF 文件
    │
    ▼
[前端 Admin] → POST /api/v1/documents/upload
    │
    ▼
[后端 DocumentController] → 保存文件到 MinIO → 保存记录到 PostgreSQL
    │
    ▼
[后端] → POST /api/v1/ingest/pipeline (调用 Agent Service)
    │
    ▼
[Agent] ingest_full_pipeline()
    │
    ├→ ingest_to_milvus()
    │     ├→ load_document()      — 解析 PDF/TXT/MD
    │     ├→ split_documents()    — 文本分块 (500字/块)
    │     ├→ embed_query()        — 向量化 (all-MiniLM-L6-v2)
    │     └→ milvus.insert()      — 写入 Milvus
    │
    └→ extract_entities_from_documents()
          ├→ LLM 抽取实体和关系    — "客户" FLOW_TO "线索"
          └→ ingest_to_neo4j()
                └→ neo4j.run()    — 写入 Neo4j 图谱
```

---

## 第二层：前端（Vue 3）

### 2.1 文件结构

```
frontend/src/
├── types.ts           # 类型定义（接口、配置）
├── api.ts             # API Client（HTTP + SSE 通信）
├── ChatWidget.vue     # 对话组件（核心 UI）
├── index.ts           # 导出入口（Vue 3 createApp 挂载）
└── vite-env.d.ts      # Vite 类型声明
```

### 2.2 types.ts — 数据结构定义

**学习重点：TypeScript 接口设计模式**

```typescript
// 组件配置接口 — 控制组件行为和外观
export interface BGAWidgetConfig {
  apiUrl: string;                          // 后端 API 地址
  projectId: string;                       // 项目 ID（数据隔离）
  token?: string;                          // 认证 Token
  theme?: "light" | "dark";               // 主题
  position?: "bottom-right" | "bottom-left"; // 浮窗位置
  title?: string;                          // 标题
  placeholder?: string;                    // 输入框占位文字
}

// 聊天消息接口
export interface ChatMessage {
  id: string;                              // 唯一标识
  role: "user" | "assistant";             // 角色
  content: string;                         // 内容
  timestamp: number;                       // 时间戳
  metadata?: {                             // 元数据（仅 assistant 有）
    intent?: string;                       //   意图类别
    citations?: Citation[];               //   引用来源
    hallucinationPassed?: boolean;        //   幻觉检测是否通过
  };
}

// 引用来源
export interface Citation {
  type: "document" | "graph";             // 文档引用 or 图谱引用
  source: string;                          // 来源名称
  score?: number;                          // 相关度分数
}
```

**💡 知识点：**
- `interface` vs `type`：接口用于定义对象形状，type 更灵活（联合类型、交叉类型）
- 可选属性用 `?` 标记，访问时需要做判空处理
- 字符串字面量类型（`"light" | "dark"`）限制取值范围，比 enum 更轻量

### 2.3 api.ts — API 通信层

**学习重点：fetch API、SSE 流式读取、AsyncGenerator**

```typescript
export class ApiClient {
  private baseUrl: string;
  private token?: string;

  // 🔑 构造函数：接收配置，初始化基础 URL 和 Token
  constructor(config: BGAWidgetConfig) {
    this.baseUrl = config.apiUrl;
    this.token = config.token;
  }

  // 🔑 统一请求头构建
  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  // 🔑 统一响应解包：后端返回 { success, data, timestamp } 格式
  private async unwrap<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Request failed (${res.status}): ${body}`);
    }
    const json: ApiResponse<T> = await res.json();
    return json.data;  // 只返回 data 部分
  }

  // 🔑 创建会话
  async createSession(projectId: string): Promise<{ id: string }> {
    const res = await fetch(`${this.baseUrl}/api/v1/chat/sessions`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ projectId }),
    });
    return this.unwrap<{ id: string }>(res);
  }

  // 🔑⭐ SSE 流式消息 — 最核心的方法
  async *streamMessage(
    sessionId: string,
    content: string,
    imageUrl?: string,
  ): AsyncGenerator<string> {
    // 1. 发起 POST 请求
    const res = await fetch(`${this.baseUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ sessionId, content, imageUrl }),
    });

    // 2. 获取 ReadableStream 的 reader
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();

    // 3. 循环读取数据块
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 4. 解码二进制为文本
      const chunk = decoder.decode(value, { stream: true });

      // 5. 解析 SSE 格式：每行 "data: xxx\n\n"
      const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
      for (const line of lines) {
        const data = line.slice(6);  // 去掉 "data: " 前缀
        if (data === "[DONE]") return;
        yield data;  // ⭐ yield 让调用方用 for-await-of 消费
      }
    }
  }
}
```

**💡 知识点：**
- **AsyncGenerator**（`async *function`）：用 `yield` 逐个产出值，调用方用 `for await (const chunk of generator)` 消费
- **ReadableStream API**：浏览器原生的流式读取，`reader.read()` 每次返回一个 chunk
- **TextDecoder**：将 `Uint8Array` 二进制数据解码为字符串，`{ stream: true }` 表示可能有多字节字符跨 chunk
- **SSE 协议**：服务端推送格式为 `data: 内容\n\n`，前端按行解析

### 2.4 ChatWidget.vue — 对话组件

**学习重点：Vue 3 Composition API、`<script setup>`、响应式系统**

#### 2.4.1 响应式状态声明

```vue
<script setup lang="ts">
import { ref, shallowRef, watch, nextTick, computed } from "vue";

// 🔑 ref() — 深层响应式引用（适合基本类型和简单对象）
const open = ref(false);              // 面板是否打开
const messages = ref<ChatMsg[]>([]);  // 消息列表
const input = ref("");                // 输入框内容
const loading = ref(false);           // 是否正在加载
const sessionId = ref<string | null>(null);  // 当前会话 ID
const streaming = ref(true);          // 是否使用流式模式

// 🔑 shallowRef() — 浅层响应式引用（适合 class 实例、复杂对象）
// ⚠️ 重要：ApiClient 是 class 实例，如果用 ref() 会被 Vue 的 Proxy 代理
//    导致 this.baseUrl 等内部属性访问异常！必须用 shallowRef()
const client = shallowRef(new ApiClient(props.config));

// 🔑 computed() — 计算属性（依赖变化时自动重新计算）
const isDark = computed(() => props.config.theme === "dark");
```

**💡 ref vs shallowRef 的关键区别：**
```
ref(new ApiClient(config))
  → Vue 对对象做深度 Proxy 代理
  → this.baseUrl 变成 Proxy 访问
  → fetch() 请求 URL 错误 ❌

shallowRef(new ApiClient(config))
  → 只追踪 .value 的引用变化
  → 对象内部属性不被代理
  → this.baseUrl 正常访问 ✅
```

#### 2.4.2 SSE 流式对话核心逻辑

```typescript
async function handleSend() {
  const text = input.value.trim();
  if (!text || loading.value) return;

  // 1. 添加用户消息
  const userMsg: ChatMsg = {
    id: uuid(),
    role: "user",
    content: text,
    timestamp: Date.now(),
  };
  messages.value.push(userMsg);
  input.value = "";
  loading.value = true;

  // 2. 确保有会话 ID
  const sid = await ensureSession();

  if (streaming.value) {
    // 3. 流式模式：先添加一个空的 assistant 消息
    const assistantId = uuid();
    const assistantMsg: ChatMsg = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
    };
    messages.value.push(assistantMsg);

    // 4. ⭐ 逐块消费 SSE 流
    for await (const chunk of client.value.streamMessage(sid, text)) {
      let textContent = chunk;
      try {
        const parsed = JSON.parse(chunk);
        if (parsed.type === "answer" && parsed.content) {
          textContent = parsed.content;
        } else if (parsed.type === "error") {
          textContent = `⚠️ ${parsed.content || "未知错误"}`;
        } else if (parsed.type === "intent" || parsed.type === "hallucination") {
          continue;  // 跳过非回答类型的事件
        }
      } catch {}

      // 5. ⭐ 追加内容到 assistant 消息（实现打字机效果）
      const idx = messages.value.findIndex((m) => m.id === assistantId);
      if (idx !== -1) {
        messages.value[idx].content += textContent;
      }
    }
  }

  loading.value = false;
}
```

**💡 知识点：**
- `for await...of`：消费 AsyncGenerator 的语法，每次 yield 产出一个值
- SSE 事件类型过滤：`type: "answer"` 是回答内容，`type: "intent"` 是意图信息（不显示给用户）
- 打字机效果：先创建空消息，然后逐块追加 `content`，Vue 的响应式系统自动触发 DOM 更新

#### 2.4.3 自动滚动到底部

```typescript
// 🔑 watch() — 侦听器：messages 数量变化时自动滚动
watch(
  () => messages.value.length,  // 监听消息数量
  () => {
    nextTick(() => {             // nextTick：等 DOM 更新完再滚动
      bottomRef.value?.scrollIntoView({ behavior: "smooth" });
    });
  },
);
```

**💡 知识点：**
- `watch(source, callback)`：当 source 变化时执行 callback
- `nextTick()`：Vue 的 DOM 更新是异步的，nextTick 确保在 DOM 更新后执行操作

### 2.5 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 在 ChatWidget.vue 中添加"清空对话"按钮 | 事件绑定、ref 操作 |
| ⭐⭐ | 添加消息复制功能（点击消息复制内容到剪贴板） | `navigator.clipboard.writeText()`、条件渲染 |
| ⭐⭐⭐ | 添加"重新生成"功能（重新发送最后一条 user 消息） | 数组操作、异步流程控制 |

---

## 第三层：后端（NestJS）

### 3.1 文件结构

```
backend/src/
├── main.ts                          # 入口：创建 Nest 应用
├── app.module.ts                    # 根模块：组装所有子模块
├── common/
│   ├── filters/all-exceptions.filter.ts  # 全局异常过滤器
│   └── interceptors/
│       ├── logging.interceptor.ts        # 日志拦截器
│       └── transform.interceptor.ts      # 响应格式化拦截器
├── infrastructure/
│   ├── milvus/                      # Milvus 向量库封装
│   ├── neo4j/                       # Neo4j 图数据库封装
│   ├── redis/                       # Redis 缓存封装
│   ├── minio/                       # MinIO 对象存储封装
│   └── infrastructure.module.ts     # 基础设施模块
└── modules/
    ├── auth/                        # 认证模块
    ├── chat/                        # 对话模块 ⭐
    ├── document/                    # 文档模块
    ├── knowledge/                   # 知识库模块
    ├── project/                     # 项目模块
    └── health/                      # 健康检查模块
```

### 3.2 app.module.ts — 模块组装

**学习重点：NestJS 模块化架构**

```typescript
@Module({
  imports: [
    // 🔑 ConfigModule — 全局配置，读取 .env 文件
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ["../.env", ".env"] }),

    // 🔑 TypeOrmModule — ORM 数据库连接
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        type: "postgres" as const,
        host: process.env.POSTGRES_HOST || "localhost",
        port: parseInt(process.env.POSTGRES_PORT || "5432", 10),
        // ... 其他连接配置
        autoLoadEntities: true,          // 自动加载实体
        synchronize: process.env.NODE_ENV === "development", // 开发环境自动同步表结构
      }),
    }),

    // 🔑 按顺序导入子模块
    InfrastructureModule,  // 基础设施先初始化（Redis、Milvus 等）
    AuthModule,            // 认证
    ProjectModule,         // 项目管理
    DocumentModule,        // 文档管理
    ChatModule,            // 对话（依赖 Infrastructure）
    KnowledgeModule,       // 知识库
    HealthModule,          // 健康检查
  ],
})
export class AppModule {}
```

**💡 NestJS 模块化思想：**
- 每个功能领域一个 Module（Chat、Project、Document...）
- Module 内部包含 Controller（路由）+ Service（业务）+ Entity（数据）
- Module 之间通过 `imports` 声明依赖关系
- `isGlobal: true` 让 ConfigModule 在所有模块中可用，无需重复导入

### 3.3 ChatController — 对话控制器

**学习重点：NestJS 装饰器、SSE 手动实现**

```typescript
@ApiTags("会话管理")
@ApiBearerAuth()
@Controller("chat")  // 🔑 路由前缀：/api/v1/chat
export class ChatController {
  constructor(private readonly chatService: ChatService) {}  // 🔑 依赖注入

  @Post("sessions")           // POST /api/v1/chat/sessions
  createSession(@Body() dto: CreateSessionDto): Promise<ChatSession> {
    return this.chatService.createSession(dto);
  }

  @Post("stream")             // POST /api/v1/chat/stream
  async streamMessages(
    @Body() dto: SendMessageDto,
    @Res() res: Response,     // 🔑 注入原生 Response 对象
  ): Promise<void> {
    // ⭐ 手动实现 SSE（不用 NestJS 的 @Sse() 装饰器，因为需要 POST 方法）
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");  // 禁用 Nginx 缓冲
    res.flushHeaders();

    const sendSse = (data: string) => {
      res.write(`data: ${data}\n\n`);  // SSE 格式
    };

    // 保存用户消息
    const userMessage = await this.chatService.saveMessage({...});
    sendSse(JSON.stringify({ type: "user_message", ... }));

    // ⭐ 调用 Agent Service 并透传 SSE 流
    const agentResponse = await fetch(`${agentUrl}/api/v1/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id, query, image_url }),
    });

    const reader = agentResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // 解析并透传每个 SSE 事件
      const lines = chunk.split("\n").filter(l => l.startsWith("data: "));
      for (const line of lines) {
        sendSse(line.slice(6));  // 透传给前端
      }
    }

    // 保存 assistant 消息到数据库
    await this.chatService.saveMessage({...});
    res.end();
  }
}
```

**💡 知识点：**
- **依赖注入**（DI）：`constructor(private readonly chatService: ChatService)` — NestJS 自动创建 ChatService 实例并注入
- **装饰器**：`@Controller`、`@Post`、`@Get`、`@Body`、`@Param` — 声明式路由定义
- **SSE 为什么手动实现**：NestJS 的 `@Sse()` 只支持 GET 请求，但我们需要 POST（携带 body），所以手动操作 `res.write()`
- **X-Accel-Buffering: no**：告诉 Nginx 不要缓冲 SSE 响应，立即转发

### 3.4 ChatService — 业务逻辑

**学习重点：TypeORM Repository 模式、Agent Service 调用**

```typescript
@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,  // 🔑 注入 Repository
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    private readonly redisService: RedisService,
  ) {}

  async createSession(dto: CreateSessionDto): Promise<ChatSession> {
    const session = this.sessionRepo.create(dto);  // 创建实体（未保存）
    return this.sessionRepo.save(session);          // 保存到数据库
  }

  async sendMessage(dto: SendMessageDto): Promise<ChatMessage> {
    // 1. 验证会话存在
    const session = await this.sessionRepo.findOneBy({ id: dto.sessionId });
    if (!session) throw new NotFoundException();

    // 2. 保存用户消息
    const userMessage = this.messageRepo.create({
      sessionId: dto.sessionId,
      role: "user",
      content: dto.content,
    });
    await this.messageRepo.save(userMessage);

    // 3. ⭐ 调用 Agent Service
    const agentResponse = await this._callAgentService(
      session.projectId,
      dto.content,
      dto.imageUrl,
    );

    // 4. 保存 assistant 消息
    const assistantMessage = this.messageRepo.create({
      sessionId: dto.sessionId,
      role: "assistant",
      content: agentResponse.answer,
      metadata: {
        intent: agentResponse.intent,
        citations: agentResponse.citations,
        hallucinationPassed: agentResponse.hallucination_passed,
      },
    });
    return this.messageRepo.save(assistantMessage);
  }

  // ⭐ 调用 Agent Service 的核心方法
  private async _callAgentService(
    projectId: string,
    query: string,
    imageUrl?: string,
  ) {
    const url = `${getAgentServiceUrl()}/api/v1/chat`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: projectId, query, image_url: imageUrl }),
    });
    return res.json();
  }
}
```

**💡 知识点：**
- **Repository 模式**：TypeORM 的 `Repository<T>` 提供对数据库表的 CRUD 操作
- `repo.create(dto)`：创建实体实例（内存中，未持久化）
- `repo.save(entity)`：保存到数据库（INSERT 或 UPDATE）
- `repo.findOneBy({ id })`：按条件查询一条记录

### 3.5 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 在 HealthController 中添加一个 `/health/detail` 端点，返回各基础设施连接状态 | Controller、Service、依赖注入 |
| ⭐⭐ | 在 ChatService 中添加消息计数缓存（Redis），避免每次查库 | RedisService、缓存策略 |
| ⭐⭐⭐ | 给 ChatController 添加 JWT 认证守卫 | Guards、@UseGuards、AuthGuard |

---

## 第四层：Agent 引擎（LangGraph）⭐ 核心

> 这是整个项目最核心的部分，建议花最多时间学习。

### 4.1 文件结构

```
agent-service/app/
├── config/settings.py          # Pydantic Settings 配置
├── main.py                     # FastAPI 入口
├── api/routes.py               # API 路由
├── graph/
│   ├── state.py                # ⭐ AgentState 状态定义
│   ├── agent_graph.py          # ⭐ 工作流图构建
│   └── nodes/                  # ⭐ 8 个工作流节点
│       ├── vision_parser.py          # 截图分析
│       ├── intent_recognition.py     # 意图识别
│       ├── retrieval_router.py       # 检索路由
│       ├── vector_retrieval.py       # 向量检索
│       ├── graph_retrieval.py        # 图谱检索
│       ├── context_combiner.py       # 上下文合并
│       ├── answer_generation.py      # 回答生成
│       └── hallucination_check.py    # 幻觉检测
├── retrieval/
│   ├── milvus_client.py        # Milvus 客户端
│   └── neo4j_client.py         # Neo4j 客户端
├── ingestion/                  # 文档摄取管线
├── prompt/
│   ├── templates.py            # Prompt 模板
│   └── injection_guard.py      # Prompt 注入防护
```

### 4.2 state.py — 工作流状态定义

**学习重点：LangGraph 状态设计、TypedDict、Annotated**

```python
from typing import TypedDict, Annotated, Literal
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class AgentState(TypedDict):
    # 🔑 消息列表 — Annotated[list, add_messages] 表示追加而非覆盖
    messages: Annotated[list[BaseMessage], add_messages]

    # 🔑 基础字段
    project_id: str                    # 项目 ID（数据隔离）
    query: str                         # 用户提问
    image_url: str | None              # 截图 URL

    # 🔑 意图识别结果
    intent: str | None                 # 意图类别
    intent_confidence: float           # 置信度 (0-1)

    # 🔑 检索策略
    retrieval_strategy: Literal["vector", "graph", "hybrid"] | None

    # 🔑 检索结果
    vector_results: list[dict]         # Milvus 检索结果
    graph_results: list[dict]          # Neo4j 检索结果

    # 🔑 生成结果
    combined_context: str              # 合并后的上下文
    answer: str                        # 生成的回答
    citations: list[dict]              # 引用来源

    # 🔑 质量检测
    hallucination_score: float         # 幻觉分数 (0-1, 越高越可能幻觉)
    hallucination_passed: bool         # 是否通过检测

    # 🔑 错误信息
    error: str | None
```

**💡 知识点：**
- **TypedDict**：Python 类型提示，定义字典的键和值类型（运行时不创建类，仅做类型检查）
- **Annotated[list[BaseMessage], add_messages]**：
  - `add_messages` 是 LangGraph 的 reducer 函数
  - 当节点返回 `{"messages": [new_msg]}` 时，不是覆盖而是追加到已有列表
  - 其他字段（如 `intent`）没有 reducer，返回值直接覆盖
- **Literal["vector", "graph", "hybrid"]**：限制取值为这三个字符串之一

### 4.3 agent_graph.py — 工作流图构建 ⭐⭐⭐

**学习重点：LangGraph StateGraph、节点、边、条件边**

```python
from langgraph.graph import StateGraph, END
from app.graph.state import AgentState


def build_agent_graph() -> StateGraph:
    # 1️⃣ 创建状态图，指定状态类型
    graph = StateGraph(AgentState)

    # 2️⃣ 添加 8 个节点（每个节点是一个函数：AgentState → dict）
    graph.add_node("vision_preprocess", vision_preprocess)
    graph.add_node("intent_recognition", intent_recognition)
    graph.add_node("retrieval_router", retrieval_router)
    graph.add_node("vector_retrieval", vector_retrieval)
    graph.add_node("graph_retrieval", graph_retrieval)
    graph.add_node("context_combiner", context_combiner)
    graph.add_node("answer_generation", answer_generation)
    graph.add_node("hallucination_check", hallucination_check)

    # 3️⃣ 设置入口节点
    graph.set_entry_point("vision_preprocess")

    # 4️⃣ 添加固定边（无条件跳转）
    graph.add_edge("vision_preprocess", "intent_recognition")
    graph.add_edge("intent_recognition", "retrieval_router")
    graph.add_edge("graph_retrieval", "context_combiner")
    graph.add_edge("context_combiner", "answer_generation")
    graph.add_edge("answer_generation", "hallucination_check")
    graph.add_edge("hallucination_check", END)

    # 5️⃣ ⭐ 添加条件边（根据状态决定跳转目标）
    graph.add_conditional_edges(
        "retrieval_router",          # 源节点
        _route_after_router,         # 路由函数：AgentState → 目标节点名
        {
            "vector_retrieval": "vector_retrieval",  # 返回 "vector_retrieval" → 跳到 vector_retrieval
            "graph_retrieval": "graph_retrieval",     # 返回 "graph_retrieval" → 跳到 graph_retrieval
        },
    )

    graph.add_conditional_edges(
        "vector_retrieval",
        _route_after_vector,         # hybrid 策略时继续走 graph_retrieval
        {
            "graph_retrieval": "graph_retrieval",
            "context_combiner": "context_combiner",
        },
    )

    # 6️⃣ 编译图（生成可执行的应用）
    return graph


# ⭐ 路由函数示例
def _route_after_router(state: AgentState) -> str:
    strategy = state.get("retrieval_strategy", "vector")
    if strategy == "graph":
        return "graph_retrieval"      # 只走图谱检索
    return "vector_retrieval"         # 默认走向量检索


# 全局单例
agent_graph = build_agent_graph()
agent_app = agent_graph.compile()
```

**💡 工作流可视化：**

```
                    ┌─────────────────┐
                    │ vision_preprocess│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │intent_recognition│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │ retrieval_router │──→ strategy="graph" ──→ graph_retrieval
                    └────────┬────────┘
                             │ strategy="vector" or "hybrid"
                    ┌────────▼────────┐
                    │ vector_retrieval │──→ strategy="hybrid" ──→ graph_retrieval
                    └────────┬────────┘
                             │ strategy="vector"
                    ┌────────▼────────┐
                    │ context_combiner │ ←── graph_retrieval
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │answer_generation │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │hallucination_check│
                    └────────┬────────┘
                             │
                            END
```

**💡 LangGraph 核心概念：**
- **StateGraph**：有状态的有向图，所有节点共享同一个 AgentState
- **Node**：一个函数，接收当前 state，返回要更新的字段（dict）
- **Edge**：固定边，节点执行完无条件跳到下一个节点
- **Conditional Edge**：条件边，根据路由函数的返回值决定跳到哪个节点
- **compile()**：编译图，生成可执行的 `CompiledGraph`，调用 `.invoke()` 或 `.astream()` 执行

### 4.4 逐节点详解

#### 4.4.1 vision_preprocess — 截图预处理

```python
async def vision_preprocess(state: AgentState) -> dict:
    image_url = state.get("image_url")
    if not image_url:
        return {"messages": []}  # ⚠️ 必须返回 dict，不能返回空 dict {}

    try:
        # 调用多模态 LLM 分析截图
        image_context = await analyze_screenshot(image_url)
        # 将截图信息追加到用户提问中
        enhanced_query = f"{state['query']}\n\n[截图上下文]: {image_context}"
        return {"query": enhanced_query, "messages": []}
    except Exception:
        return {"messages": []}  # 容错：失败不影响后续流程
```

**💡 要点：**
- 节点必须返回 `dict`，且 key 必须是 AgentState 中定义的字段
- `{"messages": []}` 不追加消息（add_messages reducer 下空列表等于不操作）
- 容错设计：截图分析失败时静默降级，不中断工作流

#### 4.4.2 intent_recognition — 意图识别 ⭐

```python
def intent_recognition(state: AgentState) -> dict:
    # 1. API Key 校验
    if not _is_valid_api_key(settings.LLM_API_KEY):
        return {"intent": "general_query", "intent_confidence": 0.5}

    try:
        # 2. 创建 LLM 实例
        llm = ChatOpenAI(
            model=settings.LLM_MODEL,        # 模型名
            api_key=settings.LLM_API_KEY,    # API Key
            base_url=settings.LLM_BASE_URL,  # 基础 URL（支持兼容接口）
            temperature=0,                    # 确定性输出
        )

        # 3. 构建消息
        messages = [
            SystemMessage(content=INTENT_RECOGNITION_SYSTEM),  # 系统提示词
            HumanMessage(content=INTENT_RECOGNITION_USER.format(query=state["query"])),  # 用户输入
        ]

        # 4. 调用 LLM
        response = llm.invoke(messages)
        content = response.content.strip()

        # 5. 解析输出（期望两行：意图 + 置信度）
        lines = [line.strip() for line in content.split("\n") if line.strip()]
        intent = lines[0] if lines else "general_query"
        confidence = float(lines[1]) if len(lines) > 1 else 0.5
    except Exception:
        intent = "general_query"      # 降级为通用意图
        confidence = 0.5

    return {"intent": intent, "intent_confidence": confidence}
```

**💡 要点：**
- **SystemMessage**：系统提示词，定义 LLM 的角色和输出格式
- **HumanMessage**：用户消息，包含实际提问
- **temperature=0**：确定性输出，相同输入总是相同输出（意图识别需要稳定性）
- **容错降级**：LLM 调用失败时返回默认意图，不中断流程
- **输出解析**：期望 LLM 按指定格式输出（两行），但做了防御性解析

#### 4.4.3 retrieval_router — 检索路由（最简单的节点，适合入门）

```python
INTENT_STRATEGY_MAP = {
    "operation_guide": "hybrid",    # 操作指引 → 向量 + 图谱
    "process_inquiry": "graph",     # 流程查询 → 仅图谱
    "concept_explanation": "vector", # 概念解释 → 仅向量
    "troubleshooting": "hybrid",    # 问题排查 → 向量 + 图谱
    "general_query": "vector",      # 通用问答 → 仅向量
}

def retrieval_router(state: AgentState) -> dict:
    intent = state.get("intent", "general_query")
    strategy = INTENT_STRATEGY_MAP.get(intent, "vector")
    return {"retrieval_strategy": strategy}
```

**💡 要点：**
- 纯逻辑节点，不调用任何外部服务
- 意图 → 策略的映射表，清晰可维护
- 返回的 `retrieval_strategy` 被 `_route_after_router` 路由函数使用，决定下一步走哪个检索节点

#### 4.4.4 vector_retrieval — 向量检索

```python
async def vector_retrieval(state: AgentState) -> dict:
    project_id = state["project_id"]
    query = state["query"]
    # 集合名 = 前缀 + 项目ID（UUID 中的 - 替换为 _）
    collection_name = f"{settings.MILVUS_COLLECTION_PREFIX}{project_id.replace('-', '_')}"

    try:
        retriever = MilvusRetriever(collection_name=collection_name)
        results = await retriever.search(query=query, top_k=5)  # 返回 top 5 相关文档
    except Exception:
        results = []  # Milvus 不可用时返回空结果

    return {"vector_results": results}
```

**💡 要点：**
- `collection_name` 按项目 ID 隔离，每个项目一个 Milvus 集合
- `top_k=5`：返回最相关的 5 个文档片段
- 容错：Milvus 不可用时不报错，返回空结果（后续节点会处理"无上下文"情况）

#### 4.4.5 graph_retrieval — 图谱检索

```python
async def graph_retrieval(state: AgentState) -> dict:
    project_id = state["project_id"]
    query = state["query"]
    intent = state.get("intent", "")

    try:
        retriever = Neo4jRetriever(project_id=project_id)
        # ⭐ 根据意图选择不同的 Cypher 查询
        results = await retriever.search(query=query, intent=intent)
    except Exception:
        results = []

    return {"graph_results": results}
```

**💡 Neo4jRetriever 内部的两种查询策略：**

```python
# 流程查询：查找实体间的流转关系
async def _search_process(self, session, query):
    cypher = """
    MATCH (e1:Entity)-[r:FLOW_TO|RELATES_TO|DEPENDS_ON]->(e2:Entity)
    WHERE e1.name CONTAINS $keyword OR e2.name CONTAINS $keyword
    RETURN e1.name, type(r), e2.name, r.description
    ORDER BY r.step_order
    """

# 通用查询：查找实体及其关联实体
async def _search_general(self, session, query):
    cypher = """
    MATCH (e:Entity)
    WHERE e.name CONTAINS $keyword
    OPTIONAL MATCH (e)-[r]-(related:Entity)
    RETURN e.name, e.description, collect(related.name)
    """
```

#### 4.4.6 context_combiner — 上下文合并

```python
def context_combiner(state: AgentState) -> dict:
    vector_results = state.get("vector_results", [])
    graph_results = state.get("graph_results", [])
    strategy = state.get("retrieval_strategy", "vector")

    context_parts = []

    # 根据策略决定包含哪些结果
    if strategy in ("vector", "hybrid") and vector_results:
        context_parts.append("## 相关文档片段\n")
        for i, doc in enumerate(vector_results, 1):
            context_parts.append(f"### 片段 {i}（来源: {doc['source']}, 相关度: {doc['score']:.2f}）\n{doc['content']}\n")

    if strategy in ("graph", "hybrid") and graph_results:
        context_parts.append("## 知识图谱关系\n")
        for i, rel in enumerate(graph_results, 1):
            context_parts.append(f"### 关系 {i}\n{rel.get('description', str(rel))}\n")

    combined_context = "\n".join(context_parts) if context_parts else "未找到相关上下文信息。"
    return {"combined_context": combined_context}
```

**💡 要点：**
- 纯逻辑节点，不调用外部服务
- 将向量检索和图谱检索的结果格式化为 LLM 可理解的文本
- 按策略过滤：`vector` 只包含文档片段，`graph` 只包含图谱关系，`hybrid` 两者都包含

#### 4.4.7 answer_generation — 回答生成 ⭐

```python
def answer_generation(state: AgentState) -> dict:
    llm = ChatOpenAI(
        model=settings.LLM_MODEL,
        api_key=settings.LLM_API_KEY,
        base_url=settings.LLM_BASE_URL,
        temperature=settings.LLM_TEMPERATURE,  # 允许一定创造性
    )

    context = state.get("combined_context", "")
    query = state["query"]
    intent = state.get("intent", "general_query")

    messages = [
        SystemMessage(content=ANSWER_GENERATION_SYSTEM.format(intent=intent)),
        HumanMessage(content=ANSWER_GENERATION_USER.format(context=context, query=query)),
    ]

    response = llm.invoke(messages)
    answer = response.content.strip()

    citations = _extract_citations(state)  # 从检索结果中提取引用

    return {"answer": answer, "citations": citations}
```

**💡 要点：**
- `temperature=settings.LLM_TEMPERATURE`（默认 0.1）：回答生成允许轻微创造性
- Prompt 模板中注入了 `intent`，让 LLM 根据意图类别调整回答风格
- `_extract_citations()`：从检索结果中提取来源信息，附加到回答中

#### 4.4.8 hallucination_check — 幻觉检测

```python
def hallucination_check(state: AgentState) -> dict:
    llm = ChatOpenAI(model=settings.LLM_MODEL, temperature=0)

    context = state.get("combined_context", "")
    answer = state.get("answer", "")

    messages = [
        SystemMessage(content=HALLUCINATION_CHECK_SYSTEM),
        HumanMessage(content=HALLUCINATION_CHECK_USER.format(context=context, answer=answer)),
    ]

    response = llm.invoke(messages)
    content = response.content.strip().lower()

    # 解析 LLM 输出
    if "pass" in content:
        score = 0.0
    elif "fail" in content:
        score = 1.0
    else:
        score = float(content)  # 0-1 之间的分数

    passed = score < 0.6  # 低于 0.6 认为通过

    return {"hallucination_score": score, "hallucination_passed": passed}
```

**💡 要点：**
- **LLM-as-Judge** 模式：用另一个 LLM 调用来评估生成的回答
- 输入：上下文 + 生成的回答，让 LLM 判断回答是否包含上下文中不存在的信息
- 阈值 0.6：低于 0.6 认为通过，高于 0.6 认为存在幻觉
- 这是最后一道防线，检测结果会随回答一起返回给前端

### 4.5 routes.py — API 路由

**学习重点：FastAPI 路由、SSE 流式响应、Prompt 安全**

```python
@router.post("/chat/stream")
async def chat_stream(request: StreamRequest):
    # 1. ⭐ Prompt 注入检测
    is_injection, reason = check_injection(request.query)
    if is_injection:
        raise HTTPException(status_code=400, detail=reason)

    # 2. 输入清洗
    sanitized_query = sanitize_input(request.query)

    # 3. 构建初始状态
    initial_state = _build_initial_state(request)

    # 4. ⭐ 执行 LangGraph 工作流，逐节点产出 SSE 事件
    async def event_generator():
        async for event in agent_app.astream(initial_state):
            node_name = list(event.keys())[0]
            node_output = event[node_name]

            if node_name == "intent_recognition":
                yield f"data: {json.dumps({'type': 'intent', 'content': node_output.get('intent')})}\n\n"
            elif node_name == "answer_generation":
                yield f"data: {json.dumps({'type': 'answer', 'content': node_output.get('answer')})}\n\n"
            elif node_name == "hallucination_check":
                yield f"data: {json.dumps({'type': 'hallucination', 'passed': node_output.get('hallucination_passed')})}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**💡 要点：**
- `agent_app.astream(initial_state)`：异步流式执行工作流，每完成一个节点 yield 一次
- 每个 SSE 事件带 `type` 字段，前端根据 type 决定如何处理
- `StreamingResponse`：FastAPI 的流式响应类，配合 async generator 使用

### 4.6 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 在 `INTENT_STRATEGY_MAP` 中新增一个意图类别 `policy_inquiry` | retrieval_router、意图扩展 |
| ⭐⭐ | 新增一个 `summary_check` 节点，检查回答是否过于简短 | 新节点、add_node、add_edge |
| ⭐⭐⭐ | 实现条件边：当 `hallucination_passed=False` 时，回到 `answer_generation` 重新生成 | add_conditional_edges、循环图 |

---

## 第五层：检索与摄取

### 5.1 MilvusRetriever — 向量检索客户端

**学习重点：pymilvus、向量索引、语义检索**

```python
class MilvusRetriever:
    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self._client: MilvusClient | None = None
        self._embedding = _get_embedding()  # Embedding 模型

    @property
    def client(self) -> MilvusClient:
        if self._client is None:
            self._client = MilvusClient(uri=f"http://{settings.MILVUS_HOST}:{settings.MILVUS_PORT}")
        return self._client

    def _ensure_collection(self):
        """确保集合存在，不存在则创建"""
        if self.client.has_collection(self.collection_name):
            return

        # 定义 Schema
        schema = self.client.create_schema(auto_id=True, enable_dynamic_field=True)
        schema.add_field("id", DataType.INT64, is_primary=True)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=settings.EMBEDDING_DIMENSION)
        schema.add_field("content", DataType.VARCHAR, max_length=65535)
        schema.add_field("source", DataType.VARCHAR, max_length=1024)
        schema.add_field("chunk_index", DataType.INT64)

        # 定义索引（IVF_FLAT + COSINE）
        index_params = self.client.prepare_index_params()
        index_params.add_index("vector", index_type="IVF_FLAT", metric_type="COSINE", params={"nlist": 128})

        self.client.create_collection(collection_name=self.collection_name, schema=schema, index_params=index_params)

    async def search(self, query: str, top_k: int = 5) -> list[dict]:
        self._ensure_collection()

        # ⭐ 1. 将查询文本向量化
        query_vector = await self._embedding.aembed_query(query)

        # ⭐ 2. 在 Milvus 中搜索最相似的向量
        results = self.client.search(
            collection_name=self.collection_name,
            data=[query_vector],
            limit=top_k,
            output_fields=["content", "source", "chunk_index"],
        )

        # 3. 格式化结果
        documents = []
        for hits in results:
            for hit in hits:
                documents.append({
                    "content": hit["entity"]["content"],
                    "source": hit["entity"]["source"],
                    "score": hit["distance"],
                })
        return documents
```

**💡 向量检索流程图：**
```
"如何新建客户？" ──→ Embedding Model ──→ [0.12, -0.34, 0.56, ...] (1536维)
                                              │
                                              ▼
                                    Milvus.search(query_vector, top_k=5)
                                              │
                                              ▼
                              ┌────────────────────────────────┐
                              │ COSINE 相似度排序，返回 Top 5   │
                              │ 1. "新建客户操作步骤..." (0.92) │
                              │ 2. "客户建档流程说明..." (0.87) │
                              │ 3. "客户信息字段说明..." (0.81) │
                              │ 4. ...                         │
                              └────────────────────────────────┘
```

**💡 Embedding 模型选择：**
```python
def _get_embedding():
    if settings.EMBEDDING_PROVIDER == "local":
        # 本地模型：all-MiniLM-L6-v2（384维，无需 API Key）
        return HuggingFaceEmbeddings(model_name=settings.EMBEDDING_MODEL)
    # OpenAI 模型：text-embedding-3-small（1536维，需要 API Key）
    return OpenAIEmbeddings(model=settings.EMBEDDING_MODEL, api_key=settings.EMBEDDING_API_KEY)
```

### 5.2 Neo4jRetriever — 图谱检索客户端

**学习重点：neo4j Python 驱动、Cypher 查询语言**

```python
class Neo4jRetriever:
    def __init__(self, project_id: str):
        self.project_id = project_id
        self._driver: AsyncDriver | None = None

    @property
    def driver(self) -> AsyncDriver:
        if self._driver is None:
            self._driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            )
        return self._driver

    async def search(self, query: str, intent: str = "") -> list[dict]:
        async with self.driver.session(database=settings.NEO4J_DATABASE) as session:
            if intent == "process_inquiry":
                return await self._search_process(session, query)  # 流程查询
            return await self._search_general(session, query)       # 通用查询

    async def ingest_entities(self, entities: list[dict]):
        """将抽取的实体和关系写入 Neo4j"""
        async with self.driver.session(database=settings.NEO4J_DATABASE) as session:
            for entity_data in entities:
                # 创建实体节点
                await session.run(
                    """MERGE (e:Entity {name: $name, project_id: $project_id})
                       SET e.category = $category, e.description = $description""",
                    name=entity_data["name"],
                    project_id=self.project_id,
                    category=entity_data.get("category", ""),
                    description=entity_data.get("description", ""),
                )
                # 创建关系边
                for rel in entity_data.get("relations", []):
                    await session.run(
                        """MATCH (a:Entity {name: $source, project_id: $project_id})
                           MATCH (b:Entity {name: $target, project_id: $project_id})
                           MERGE (a)-[r:FLOW_TO]->(b)
                           SET r.description = $desc, r.step_order = $step""",
                        source=rel["source"],
                        target=rel["target"],
                        project_id=self.project_id,
                        desc=rel.get("description", ""),
                        step=rel.get("step_order", 0),
                    )
```

**💡 Cypher 查询语法速查：**
```
MATCH      — 查找节点/关系（类似 SQL 的 FROM）
WHERE      — 过滤条件
RETURN     — 返回字段
OPTIONAL MATCH — 左连接（允许不匹配）
MERGE      — 存在则匹配，不存在则创建（类似 INSERT ON CONFLICT）
SET        — 设置属性
CREATE     — 强制创建（不检查是否存在）
```

### 5.3 摄取管线

**学习重点：文档解析、文本分块、实体抽取**

```
ingest_full_pipeline(file_path, project_id)
    │
    ├→ ingest_to_milvus()
    │     │
    │     ├→ load_document(file_path)         # 解析文件
    │     │     ├─ .pdf → PyPDFLoader
    │     │     ├─ .txt → TextLoader
    │     │     └─ .md  → TextLoader
    │     │
    │     ├→ split_documents(docs, 500, 50)   # 文本分块
    │     │     └─ RecursiveCharacterTextSplitter
    │     │         separators: ["\n\n", "\n", "。", "；", "，", " ", ""]
    │     │         chunk_size: 500 字符
    │     │         chunk_overlap: 50 字符（块间重叠，避免语义截断）
    │     │
    │     ├→ embed_query(chunk)               # 向量化
    │     │
    │     └→ milvus.insert(vectors)           # 写入 Milvus
    │
    └→ extract_entities_from_documents(chunks)
          │
          ├→ LLM 抽取实体和关系              # 每个 chunk 调用一次 LLM
          │     输出格式：{ "entities": [...], "relations": [...] }
          │
          └→ ingest_to_neo4j(entities)
                ├→ MERGE Entity 节点          # 创建/更新实体
                └→ MERGE 关系边               # 创建/更新关系
```

**💡 文本分块策略：**
```
原文：████████████████████████████████████████████████████████████

分块（chunk_size=20, chunk_overlap=5）：
  Chunk 1: ████████████████████
  Chunk 2:                ████████████████████
  Chunk 3:                               ████████████████████

重叠部分确保跨块边界的语义不被截断
```

### 5.4 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 修改 `chunk_size` 和 `chunk_overlap`，观察检索效果变化 | text_splitter、向量检索质量 |
| ⭐⭐ | 在 `document_loader.py` 中添加 `.docx` 格式支持 | LangChain DocumentLoader |
| ⭐⭐⭐ | 在 MilvusRetriever 中实现混合检索（向量 + 关键词 BM25） | pymilvus、混合检索 |

---

## 第六层：Prompt 工程与安全

### 6.1 templates.py — Prompt 模板

**学习重点：Prompt Engineering、格式化模板**

项目中有 4 组 Prompt 模板：

| 模板 | 用途 | 关键设计 |
|------|------|----------|
| `INTENT_RECOGNITION_SYSTEM/USER` | 意图识别 | 严格指定输出格式（两行：意图+置信度） |
| `ANSWER_GENERATION_SYSTEM/USER` | 回答生成 | 注入意图类别，按意图调整回答风格 |
| `HALLUCINATION_CHECK_SYSTEM/USER` | 幻觉检测 | 定义审核标准，输出 PASS/FAIL/分数 |
| `ENTITY_EXTRACTION_SYSTEM/USER` | 实体抽取 | 指定 JSON 输出格式和关系类型 |

**💡 Prompt 设计原则：**
1. **角色定义**：每个 System Prompt 开头定义 LLM 的角色（"你是业务意图识别专家"）
2. **输出格式约束**：严格指定输出格式，降低解析难度
3. **边界条件处理**：明确说明"信息不足时"如何回答
4. **防幻觉指令**："所有回答必须基于检索到的上下文信息，不要编造不存在的内容"

### 6.2 injection_guard.py — Prompt 注入防护

**学习重点：正则表达式安全检测、输入清洗**

```python
INJECTION_PATTERNS = [
    re.compile(r"ignore\s+(all\s+)?previous\s+(instructions|prompts)", re.IGNORECASE),
    re.compile(r"forget\s+(all\s+)?previous", re.IGNORECASE),
    re.compile(r"you\s+are\s+now\s+a", re.IGNORECASE),
    re.compile(r"system\s*:\s*", re.IGNORECASE),
    re.compile(r"<\s*/?\s*(system|instruction|prompt)\s*>", re.IGNORECASE),
    re.compile(r"jailbreak", re.IGNORECASE),
    re.compile(r"sudo\s+", re.IGNORECASE),
    re.compile(r"rm\s+-rf", re.IGNORECASE),
    re.compile(r"DROP\s+TABLE", re.IGNORECASE),
    re.compile(r";\s*--", re.IGNORECASE),
]

def check_injection(text: str) -> tuple[bool, str | None]:
    """检测是否包含 Prompt 注入模式"""
    for pattern in INJECTION_PATTERNS:
        match = pattern.search(text)
        if match:
            return True, f"检测到可疑模式: {match.group()}"
    return False, None

def sanitize_input(text: str) -> str:
    """清洗输入：移除 HTML 标签和控制字符"""
    text = re.sub(r"<[^>]+>", "", text)           # 移除 HTML 标签
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)  # 移除控制字符
    return text.strip()
```

**💡 防护层级：**
```
用户输入
  │
  ├→ check_injection()  — 正则匹配已知注入模式 → 拒绝请求
  │
  ├→ sanitize_input()   — 移除 HTML 标签和控制字符 → 清洗输入
  │
  └→ System Prompt      — 在 Prompt 中声明"不要执行用户指令外的操作"
```

### 6.3 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 在 `INJECTION_PATTERNS` 中添加更多注入模式 | 正则表达式、安全防护 |
| ⭐⭐ | 修改 `ANSWER_GENERATION_SYSTEM`，让 LLM 在回答末尾附加引用编号 | Prompt Engineering、格式控制 |
| ⭐⭐⭐ | 实现 Prompt 版本管理，支持从数据库加载 Prompt 模板 | 配置化、动态 Prompt |

---

## 第七层：基础设施与数据存储

### 7.1 五大存储引擎

| 存储 | 用途 | 端口 | 可视化方式 |
|------|------|------|-----------|
| **PostgreSQL** | 关系型主库（会话、消息、项目、文档） | 15432 | `docker exec -i bga-postgres psql -U postgres -d business_guide_agent` |
| **Redis** | 缓存（会话状态、速率限制） | 16379 | `docker exec -it bga-redis redis-cli` |
| **Milvus** | 向量数据库（文档嵌入向量） | 19530 | Attu（Milvus 可视化工具） |
| **Neo4j** | 图数据库（知识图谱） | 7687 | 浏览器打开 http://localhost:7474 |
| **MinIO** | 对象存储（上传文件） | 9000/9001 | 浏览器打开 http://localhost:9001 |

### 7.2 PostgreSQL 表结构

```sql
-- 项目表
projects (id, name, description, createdAt, updatedAt)

-- 文档表
documents (id, projectId, filename, originalName, mimeType, size, url, status, createdAt)

-- 会话表
chat_sessions (id, projectId, title, createdAt, updatedAt)

-- 消息表
chat_messages (id, sessionId, role, content, metadata, createdAt)

-- 用户表
users (id, username, email, password, role, createdAt)

-- 知识库表
knowledge_bases (id, projectId, name, type, config, createdAt)
```

### 7.3 Milvus 集合结构

```
Collection: bga_{project_id_with_underscores}
  ├── id          (INT64, 主键, 自增)
  ├── vector      (FLOAT_VECTOR, dim=384/1536, IVF_FLAT + COSINE 索引)
  ├── content     (VARCHAR, 文档片段内容)
  ├── source      (VARCHAR, 来源文件名)
  └── chunk_index (INT64, 片段序号)
```

### 7.4 Neo4j 图谱模型

```
(:Entity {
  name: "客户",
  category: "业务对象",
  description: "客户是...",
  project_id: "xxx"
})

(:Entity)-[:FLOW_TO {description: "建档后流转", step_order: 1}]->(:Entity)
(:Entity)-[:DEPENDS_ON {description: "审批依赖"}]->(:Entity)
(:Entity)-[:RELATES_TO {description: "一般关联"}]->(:Entity)
```

### 7.5 动手练习

| 难度 | 练习内容 | 涉及知识点 |
|------|---------|-----------|
| ⭐ | 用 psql 查询 `chat_messages` 表，看看对话记录 | SQL、TypeORM |
| ⭐⭐ | 在 Neo4j Browser 中执行 Cypher，查看知识图谱 | Cypher、图可视化 |
| ⭐⭐⭐ | 用 pymilvus 查询某个集合的向量数量和索引信息 | pymilvus、向量数据库 |

---

## 附录：核心概念速查

### A. LangGraph 核心概念

| 概念 | 说明 | 代码示例 |
|------|------|---------|
| StateGraph | 有状态的有向图 | `graph = StateGraph(AgentState)` |
| add_node | 添加节点（函数） | `graph.add_node("name", func)` |
| add_edge | 添加固定边 | `graph.add_edge("A", "B")` |
| add_conditional_edges | 添加条件边 | `graph.add_conditional_edges("A", router_func, {"B": "B", "C": "C"})` |
| set_entry_point | 设置入口节点 | `graph.set_entry_point("A")` |
| compile | 编译图 | `app = graph.compile()` |
| invoke | 同步执行 | `result = app.invoke(initial_state)` |
| astream | 异步流式执行 | `async for event in app.astream(initial_state)` |
| Annotated + reducer | 状态字段的合并策略 | `messages: Annotated[list, add_messages]` |

### B. Vue 3 Composition API 速查

| API | 说明 | 示例 |
|-----|------|------|
| ref | 深层响应式引用 | `const count = ref(0)` → `count.value++` |
| shallowRef | 浅层响应式引用 | `const client = shallowRef(new ApiClient())` |
| computed | 计算属性 | `const double = computed(() => count.value * 2)` |
| watch | 侦听器 | `watch(count, (newVal) => console.log(newVal))` |
| nextTick | DOM 更新后回调 | `nextTick(() => el.scrollIntoView())` |
| defineProps | 声明 props | `const props = defineProps<{ config: Config }>()` |
| v-model | 双向绑定 | `<input v-model="input" />` |
| v-if / v-show | 条件渲染 | `<div v-if="open">...</div>` |
| v-for | 列表渲染 | `<div v-for="msg in messages" :key="msg.id">` |

### C. NestJS 装饰器速查

| 装饰器 | 说明 | 示例 |
|--------|------|------|
| @Module | 定义模块 | `@Module({ imports, controllers, providers })` |
| @Controller | 定义控制器 | `@Controller("chat")` → `/api/v1/chat` |
| @Get / @Post | 路由方法 | `@Post("sessions")` → `POST /api/v1/chat/sessions` |
| @Body | 请求体参数 | `@Body() dto: CreateDto` |
| @Param | 路径参数 | `@Param("id") id: string` |
| @Injectable | 可注入服务 | `@Injectable() class ChatService {}` |
| @InjectRepository | 注入 Repository | `@InjectRepository(Entity) repo: Repository<Entity>` |

### D. Cypher 速查

| 语句 | 说明 | 示例 |
|------|------|------|
| MATCH | 查找模式 | `MATCH (n:Entity) RETURN n` |
| WHERE | 过滤 | `WHERE n.name CONTAINS "客户"` |
| MERGE | 存在则匹配，否则创建 | `MERGE (n:Entity {name: $name})` |
| SET | 设置属性 | `SET n.description = $desc` |
| CREATE | 强制创建 | `CREATE (n:Entity {name: "test"})` |
| RETURN | 返回结果 | `RETURN n.name, n.description` |
| OPTIONAL MATCH | 左连接 | `OPTIONAL MATCH (n)-[r]->(m)` |
| collect | 聚合为数组 | `collect(m.name)` |

### E. SSE 协议速查

```
服务端发送格式：
  data: {"type": "answer", "content": "你好"}\n\n
  data: {"type": "intent", "content": "general_query"}\n\n
  data: [DONE]\n\n

前端解析：
  1. 按换行分割
  2. 过滤以 "data: " 开头的行
  3. 去掉 "data: " 前缀，得到 JSON 字符串
  4. JSON.parse() 解析内容
  5. 遇到 "[DONE]" 结束
```

---

> 📌 **学习建议**：从 `retrieval_router.py`（16 行代码）开始读，它是最简单的节点，帮你理解 LangGraph 节点的输入输出模式。然后按 4.4 节的顺序逐个阅读其他节点。