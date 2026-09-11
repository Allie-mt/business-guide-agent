# Business Guide Agent — 项目技术方案

> 版本：v0.3.0 | 更新日期：2026-09-11

---

## 1. 项目概述

### 1.1 项目定位

Business Guide Agent（BGA）是一个基于 **RAG（检索增强生成）** 架构的智能业务指引系统。它结合**向量检索**（Milvus）和**知识图谱**（Neo4j）双通道检索，为不同项目的业务操作提供精准、可操作的指引回答。

### 1.2 核心价值

| 能力 | 描述 |
|------|------|
| 多项目隔离 | 每个项目拥有独立的知识库（向量集合 + 图谱标签），可嵌入不同业务系统 |
| 双通道检索 | 向量检索擅长语义匹配，知识图谱擅长流程/关系查询，按意图自动路由 |
| 意图驱动 | 识别 5 类业务意图，自动选择最优检索策略（vector / graph / hybrid） |
| 幻觉检测 | 生成回答后自动校验与上下文的一致性，标注"通过/存疑" |
| 截图理解 | 支持上传系统截图，通过多模态 LLM 分析界面元素辅助回答 |
| 流式对话 | SSE 实时流式输出，支持中途终止，用户体验流畅 |
| 文档摄取 | 支持 PDF/TXT/MD 文档上传，自动分块 + 向量化 + 实体抽取 + 图谱构建 |
| 后台摄取 | 生产环境通过 IngestWorker 后台线程轮询 Redis 队列异步处理摄取任务 |

### 1.3 技术栈总览

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Vite + TypeScript)                       │
│  - ChatWidget.vue: 对话组件 (Composition API + SSE)         │
│  - admin/: 管理后台 (Vue 3 + Vue Router + Axios)            │
├─────────────────────────────────────────────────────────────┤
│  Backend (NestJS + TypeORM + PostgreSQL)                    │
│  - REST API + SSE 流式接口                                  │
│  - Auth / Project / Document / Chat / Knowledge 模块        │
├─────────────────────────────────────────────────────────────┤
│  Agent Service (FastAPI + LangGraph + LangChain)            │
│  - 8 节点 Agent 工作流 (意图→路由→检索→回答→校验)            │
│  - Ingestion 管线 (分块→向量化→实体抽取→图谱构建)            │
│  - IngestWorker 后台摄取 (Redis 队列轮询)                   │
├─────────────────────────────────────────────────────────────┤
│  Infrastructure (Docker Compose)                            │
│  PostgreSQL │ Redis │ Milvus(+etcd+minio) │ Neo4j │ MinIO  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 系统架构

### 2.1 整体架构图

```
                          ┌─────────────────────┐
                          │     Browser          │
                          │  ┌───────┐ ┌──────┐ │
                          │  │ Chat  │ │Admin │ │
                          │  │Widget │ │Panel │ │
                          │  └───┬───┘ └──┬───┘ │
                          └──────┼────────┼─────┘
                                 │SSE/REST│REST
                          ┌──────┴────────┴─────┐
                          │   Backend :3000      │
                          │   (NestJS)           │
                          │  ┌────────────────┐  │
                          │  │ ChatController │  │
                          │  │  ├ POST /stream│  │
                          │  │  ├ POST /msg   │  │
                          │  │  └ POST /sess │  │
                          │  └───────┬────────┘  │
                          │  ┌───────┴────────┐  │
                          │  │  ChatService    │  │
                          │  │  ├ TypeORM      │  │
                          │  │  ├ Redis        │  │
                          │  │  └ HTTP→Agent  │  │
                          │  └────────────────┘  │
                          └──────────┬───────────┘
                                     │HTTP
                          ┌──────────┴───────────┐
                          │  Agent Service :8000  │
                          │  (FastAPI+LangGraph)  │
                          │                       │
                          │  ┌─────────────────┐ │
                          │  │  Agent Workflow  │ │
                          │  │  vision_preprocess│ │
                          │  │       ↓          │ │
                          │  │  intent_recognition│ │
                          │  │       ↓          │ │
                          │  │  retrieval_router│ │
                          │  │      ↙  ↘        │ │
                          │  │  vector  graph   │ │
                          │  │   retrieval     │ │
                          │  │      ↘  ↙        │ │
                          │  │  context_combine │ │
                          │  │       ↓          │ │
                          │  │  answer_generate │ │
                          │  │       ↓          │ │
                          │  │  hallucination   │ │
                          │  │    _check        │ │
                          │  └─────────────────┘ │
                          │  ┌─────────────────┐ │
                          │  │  IngestWorker    │ │
                          │  │  (Redis Queue)   │ │
                          │  └─────────────────┘ │
                          └──┬──────┬──────┬─────┘
                             │      │      │
                    ┌────────┴┐  ┌─┴───┐ ┌┴────┐
                    │  Milvus  │  │Neo4j│ │ LLM │
                    │ (向量库) │  │(图谱)│ │(OpenAI兼容)│
                    └─────────┘  └─────┘ └─────┘
```

### 2.2 数据流

**对话流程（SSE 流式）：**

```
用户输入 → Frontend → POST /api/v1/chat/stream
  → Backend ChatController (建立 SSE 连接)
    → ChatService.streamMessage()
      → HTTP POST → Agent Service /api/v1/chat/stream
        → LangGraph Agent Workflow:
          1. vision_preprocess  (如有截图，调用多模态LLM分析)
          2. intent_recognition (LLM识别意图类别+置信度)
          3. retrieval_router   (意图→检索策略映射)
          4. vector_retrieval   (Milvus向量相似度检索)
          5. graph_retrieval    (Neo4j图谱关系查询) [可选]
          6. context_combiner   (合并多源检索结果)
          7. answer_generation  (LLM async generator 流式生成回答)
          8. hallucination_check(LLM校验回答与上下文一致性)
        ← SSE 逐节点流式返回 (token/intent/hallucination 事件)
      ← Backend 透传 SSE chunks
    ← Frontend 解析 SSE data 渲染
```

**文档摄取流程（同步管线）：**

```
上传文件 → Backend → MinIO 存储
  → POST /documents/:id/ingest
    → Agent Service /api/v1/ingest/pipeline
      → 下载文件 (httpx 从 MinIO 预签名URL)
      → document_loader  (pypdf/TextLoader, PDF/TXT/MD 解析)
      → text_splitter    (递归字符分块, 500字/块, 50字重叠)
      → vector_ingest    (Embedding → Milvus 插入)
      → entity_extractor (LLM抽取实体+关系)
      → graph_ingest     (Neo4j 创建节点+边)
```

**文档摄取流程（后台队列，生产环境）：**

```
上传文件 → Backend → MinIO 存储
  → Redis RPUSH ingest:queue:{document_id}
  → IngestWorker 轮询 Redis SCAN ingest:queue:*
    → 读取 ingest:pending:{document_id} 获取 payload
    → 从 MinIO 下载文件 (boto3)
    → ingest_to_milvus() 向量化写入
    → 清理 Redis 队列键 + 临时文件
```

---

## 3. 技术选型与依据

### 3.1 前端

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| Vue 3 | 3.5+ | Composition API + `<script setup>` 语法简洁，响应式系统轻量，适合嵌入式组件开发 |
| Vite | 5.3+ | 极速 HMR，原生 ESM 开发，lib 模式构建可嵌入组件 |
| TypeScript | 5.5+ | 类型安全，IDE 智能提示，减少运行时错误 |
| markdown-it | 14.1+ | 轻量 Markdown 渲染，支持插件扩展 |

### 3.2 管理后台

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| Vue 3 | 3.5+ | 与前端 ChatWidget 技术栈统一，组件复用 |
| Vue Router | 4.x | SPA 路由管理，支持 Dashboard / ProjectDetail 视图切换 |
| Vite | 5.3+ | 开发体验一致，快速 HMR |
| Axios | 1.x | HTTP 客户端，拦截器统一处理响应包装和错误 |
| TypeScript | 5.5+ | 类型安全，与前端共享类型定义 |

### 3.3 后端

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| NestJS | 10.4+ | 企业级 Node.js 框架，模块化架构，内置 DI/AOP/Guard，适合中大型后端 |
| TypeORM | 0.3+ | NestJS 官方推荐 ORM，支持 PostgreSQL，装饰器语法简洁 |
| PostgreSQL | 16 | 关系型主库，存储项目/文档/会话/消息等结构化数据 |
| Redis | 7 | 缓存 + 会话状态 + 摄取任务队列，Agent Service 调用结果缓存 |
| MinIO | latest | S3 兼容对象存储，存储上传的文档文件和截图 |

### 3.4 Agent Service

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| FastAPI | 0.111+ | 高性能异步 Python 框架，自动 OpenAPI 文档，适合 AI 服务 |
| LangGraph | 0.2+ | LangChain 工作流引擎，StateGraph 原生支持条件边、循环、状态管理 |
| LangChain | 0.2+ | LLM 应用开发框架，统一 Embedding/Chat/Retrieval 接口 |
| Pydantic | 2.7+ | 数据校验 + Settings 管理，类型安全的配置加载 |
| httpx | 0.27+ | 异步 HTTP 客户端，用于 Pipeline 摄取时从 MinIO 下载文件 |
| sentence-transformers | 3.0+ | 本地 Embedding 推理，避免 API 调用延迟 |
| boto3 | — | AWS SDK for Python，IngestWorker 从 MinIO 下载文件（运行时 import） |

> **依赖注意**：`boto3` 在 `ingest_worker.py` 中通过 `import boto3` 使用，但当前未列入 `requirements.txt`，部署时需手动添加或确认已安装。`torch` 使用 CPU 版本（`--extra-index-url https://download.pytorch.org/whl/cpu`）以减小镜像体积。

### 3.5 向量数据库 & 知识图谱

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| Milvus | 2.4.14 | 云原生向量数据库，支持 IVF_FLAT/HNSW 索引，亿级向量检索 |
| Neo4j | 5.21-community | 原生图数据库，Cypher 查询语言，适合业务流程/实体关系建模，内置 APOC 插件 |

### 3.6 LLM

| 配置项 | 代码默认值 | 说明 |
|--------|------------|------|
| LLM_PROVIDER | openai | 兼容 OpenAI API 的任意提供商 |
| LLM_MODEL | gpt-4o | 代码默认 GPT-4o；部署时可切换为 glm-4-flash / deepseek-chat 等 |
| LLM_BASE_URL | https://api.openai.com/v1 | 代码默认 OpenAI 端点；切换智谱 AI 时设为 https://open.bigmodel.cn/api/paas/v4 |
| LLM_API_KEY | (空) | 需在 .env 中填入对应提供商的 API Key |
| LLM_TEMPERATURE | 0.1 | 低温度保证回答稳定性 |
| EMBEDDING_PROVIDER | openai | 代码默认 openai（API 嵌入）；可切换为 local（sentence-transformers 本地嵌入） |
| EMBEDDING_MODEL | text-embedding-3-small | OpenAI Embedding 模型（1536维）；本地模式使用 all-MiniLM-L6-v2（384维） |
| EMBEDDING_API_KEY | (空) | OpenAI Embedding API Key（local 模式不需要） |
| EMBEDDING_BASE_URL | https://api.openai.com/v1 | Embedding API 端点 |
| EMBEDDING_DIMENSION | 1536 | OpenAI text-embedding-3-small 维度；本地 all-MiniLM-L6-v2 为 384 |

> **部署配置示例**：使用智谱 AI GLM-4-Flash + 本地 Embedding 时，.env 设置：
> ```
> LLM_MODEL=glm-4-flash
> LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4
> LLM_API_KEY=your-zhipu-api-key
> EMBEDDING_PROVIDER=local
> EMBEDDING_MODEL=all-MiniLM-L6-v2
> EMBEDDING_DIMENSION=384
> ```

---

## 4. 模块详细设计

### 4.1 Frontend — ChatWidget.vue

**文件**：`frontend/src/ChatWidget.vue`

**技术方案**：Vue 3 SFC + Composition API (`<script setup>`)

**核心状态**：

```typescript
const open = ref(false)                          // 面板开关
const messages = ref<ChatMsg[]>([])              // 消息列表
const input = ref("")                            // 输入框
const loading = ref(false)                       // 发送中
const sessionId = ref<string | null>(null)       // 会话ID
const streaming = ref(true)                      // 流式开关
const screenshotUrl = ref<string>()              // 截图URL
const screenshotPreview = ref<string>()          // 截图预览
const abortController = ref<AbortController | null>(null) // 流式中止控制器
const client = shallowRef(new ApiClient(config)) // API客户端(shallowRef避免响应式代理破坏class)
```

**关键设计**：

- `shallowRef` 包装 `ApiClient` 实例，避免 Vue 深度响应式代理破坏 class 的 `this` 绑定
- `uuid()` 兼容函数：优先 `crypto.randomUUID()`，不可用时回退 `Math.random()` 生成 UUID v4
- SSE 流式解析：`for await (const chunk of client.streamMessage(...))` 逐 chunk 解析 JSON，过滤 `intent`/`hallucination` 等内部事件，只渲染 `token`/`answer` 类型内容
- **流式中止**：通过 `AbortController` + `signal` 传递给 `fetch`，用户点击停止按钮可中断流式输出
- Markdown 渲染：`markdown-it` 渲染 assistant 消息，支持代码块、链接、表格、引用等
- 深色主题：通过 `isDark` computed 控制 CSS class 切换
- 引用来源：`citations` 卡片可折叠展示（当前通过 `v-if="false"` 暂时隐藏）

### 4.2 Frontend — Admin Panel

**文件**：`admin/`

**技术方案**：Vue 3 + Vue Router + Vite + TypeScript + Axios（独立 SPA 应用）

**路由设计**：

| 路径 | 组件 | 功能 |
|------|------|------|
| `/` | Dashboard.vue | 项目列表、创建/删除项目 |
| `/project/:id` | ProjectDetail.vue | 文档管理、上传/摄取/删除 |

**功能**：
- 项目管理：创建/选择/删除项目（卡片式布局）
- 文档管理：上传（拖拽+点击）、删除、单个/批量摄取
- 摄取状态：pending → processing → completed / failed 实时刷新
- 对话入口：每个项目提供"打开对话"链接跳转至 ChatWidget

> **部署注意**：Admin Panel 的 `api.ts` 使用 `baseURL: "/api/v1"`，要求 Admin 与 Backend 同源部署，或通过反向代理（如 Nginx）将 `/api/v1` 路径转发至 Backend 服务。

**API 封装**（`admin/src/api.ts`）：
- Axios 实例 + 拦截器：自动解包 `{ success, data }` 响应包装
- `projectApi`：list / create / delete
- `documentApi`：listByProject / upload / ingest / delete

### 4.3 Frontend — API Client

**文件**：`frontend/src/api.ts`

**类设计**：`ApiClient`

| 方法 | 端点 | 说明 |
|------|------|------|
| `createSession(projectId)` | POST /api/v1/chat/sessions | 创建会话 |
| `sendMessage(sessionId, content, imageUrl?)` | POST /api/v1/chat/messages | 非流式发送 |
| `*streamMessage(sessionId, content, imageUrl?, signal?)` | POST /api/v1/chat/stream | SSE 流式发送（AsyncGenerator，支持 AbortSignal） |
| `uploadScreenshot(file)` | POST /api/v1/documents/upload-screenshot | 上传截图 |

**SSE 解析**：使用 `ReadableStream` + `TextDecoder` 逐块读取，按 `\n` 分行，提取 `data: ` 前缀内容，遇到 `[DONE]` 结束。

**响应解包**：`unwrap<T>()` 方法自动解包 Backend 的 `{ success, data, timestamp }` 响应包装。

### 4.4 Backend — Chat Module

**文件**：`backend/src/modules/chat/`

**Controller 端点**：

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/chat/sessions | 创建会话 |
| GET | /api/v1/chat/sessions/project/:projectId | 获取项目会话列表 |
| GET | /api/v1/chat/sessions/:sessionId/messages | 获取会话消息 |
| POST | /api/v1/chat/messages | 非流式发送消息 |
| POST | /api/v1/chat/stream | SSE 流式对话 |

**SSE 流式实现**：

```typescript
// ChatController.streamMessages()
res.setHeader("Content-Type", "text/event-stream");
res.setHeader("Cache-Control", "no-cache");
res.setHeader("Connection", "keep-alive");
res.setHeader("X-Accel-Buffering", "no");
res.flushHeaders();

// 先发送 user_message 事件
sendSse(JSON.stringify({ type: "user_message", id, content }));

// 透传 Agent Service SSE 流
for await (const chunk of this.chatService.streamMessage(...)) {
  sendSse(chunk);
}
sendSse("[DONE]");
res.end();
```

**ChatService.streamMessage()**：调用 Agent Service 的 `/api/v1/chat/stream` 端点，透传 SSE 流。

**ChatService.sendMessage()**（非流式）：
- 缓存检查：Redis 缓存 key `chat:cache:{projectId}:{query}`，TTL 300s
- 调用 Agent Service `/api/v1/chat` 非流式端点
- 保存 assistant 消息（含 metadata: intent, retrievalStrategy, citations, hallucination）

### 4.5 Backend — Infrastructure Module

**文件**：`backend/src/infrastructure/`

| 服务 | 用途 |
|------|------|
| MilvusService | 向量数据库客户端（集合管理、索引创建） |
| Neo4jService | 图数据库客户端（Cypher 查询） |
| RedisService | 缓存 + 会话状态管理 + 摄取任务队列 |
| MinioService | 对象存储（文档/截图上传下载） |

### 4.6 Agent Service — LangGraph Workflow

**文件**：`agent-service/app/graph/agent_graph.py`

**状态定义**（`AgentState`）：

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    project_id: str
    query: str
    image_url: str | None
    intent: str | None                    # 意图类别
    intent_confidence: float              # 意图置信度
    retrieval_strategy: Literal["vector", "graph", "hybrid"] | None
    vector_results: list[dict]            # 向量检索结果
    graph_results: list[dict]             # 图谱检索结果
    combined_context: str                 # 合并后的上下文
    answer: str                           # 生成的回答
    citations: list[dict]                 # 引用来源
    hallucination_score: float            # 幻觉分数
    hallucination_passed: bool            # 幻觉校验结果
    error: str | None
```

**8 节点工作流**：

```
┌─────────────────┐
│ vision_preprocess│ ← 入口节点，处理截图(多模态LLM)
└────────┬────────┘
         ↓
┌─────────────────┐
│intent_recognition│ ← LLM识别5类意图 + 置信度
└────────┬────────┘
         ↓
┌─────────────────┐
│ retrieval_router │ ← 意图→策略映射
└────────┬────────┘
      ↙       ↘
┌──────────┐ ┌──────────┐
│  vector   │ │  graph   │
│ retrieval │ │ retrieval│
└─────┬────┘ └─────┬────┘
      ↘       ↙
┌─────────────────┐
│ context_combiner │ ← 合并多源结果 + 去重
└────────┬────────┘
         ↓
┌─────────────────┐
│answer_generation │ ← LLM async generator 流式生成
└────────┬────────┘
         ↓
┌─────────────────┐
│hallucination_check│ ← LLM校验回答与上下文一致性
└─────────────────┘
```

**条件边路由**：

- `retrieval_router` → `vector_retrieval`（strategy=vector 或 hybrid）
- `retrieval_router` → `graph_retrieval`（strategy=graph）
- `vector_retrieval` → `graph_retrieval`（strategy=hybrid，还需图谱补充）
- `vector_retrieval` → `context_combiner`（strategy=vector，无需图谱）

**流式输出**：`answer_generation` 节点为 async generator 函数，通过 `yield {"answer": partial}` 逐 token 流式输出，SSE 端通过 `agent_app.astream_events(initial_state, version="v2")` 捕获流式事件。

### 4.7 Agent Service — 意图识别与检索路由

**意图类别**：

| 意图 | 说明 | 检索策略 |
|------|------|----------|
| `operation_guide` | 操作指引（"怎么新建客户"） | hybrid（向量+图谱） |
| `process_inquiry` | 流程查询（"客户建档后怎么流转"） | graph（图谱优先） |
| `concept_explanation` | 概念解释（"什么是商机"） | vector（向量语义匹配） |
| `troubleshooting` | 问题排查（"报错XXX怎么办"） | hybrid（向量+图谱） |
| `general_query` | 通用问答 | vector（向量语义匹配） |

**路由映射**：`INTENT_STRATEGY_MAP` 硬编码在 `retrieval_router.py`，可扩展。

**降级处理**：当 `LLM_API_KEY` 未配置或以 `sk-your` 开头时，`intent_recognition` 节点直接返回 `general_query` + 置信度 0.5，避免 LLM 调用失败。

### 4.8 Agent Service — 双通道检索

**向量检索**（`MilvusRetriever`）：

- Embedding 模型：`sentence-transformers/all-MiniLM-L6-v2`（本地，384维）或 OpenAI Embedding
- 索引类型：`IVF_FLAT`，度量 `COSINE`，`nlist=128`
- 检索参数：`top_k=5`
- 相关性过滤：`MIN_RELEVANCE_SCORE = 0.3`，低于阈值的结果被过滤
- 返回：`[{content, source, score, chunk_index}]`

**图谱检索**（`Neo4jRetriever`）：

- 按意图分两种 Cypher 查询：
  - `process_inquiry`：沿 `FLOW_TO`/`RELATES_TO`/`DEPENDS_ON` 边遍历流程链，按 `step_order` 排序
  - 其他意图：按关键词匹配实体节点 + 关系，`OPTIONAL MATCH` 获取关联实体
- 关键词提取：`_extract_keyword()` 移除中文停用词（的/了/是/怎么/如何/什么等）
- 实体标签：`Entity`，属性 `project_id` 实现项目隔离
- 关系类型：`FLOW_TO`（流转）、`DEPENDS_ON`（依赖）、`RELATES_TO`（关联）

### 4.9 Agent Service — 幻觉检测

**文件**：`agent-service/app/graph/nodes/hallucination_check.py`

**方案**：LLM-as-Judge

- 将 `combined_context` 和 `answer` 发送给 LLM
- Prompt 要求判断回答是否与上下文一致
- LLM 返回 `pass` / `fail` / 0-1 置信度分数
- 判定逻辑：`pass` → score=0.0，`fail` → score=1.0，数值 → 直接使用
- 通过阈值：`hallucination_passed = score < 0.6`
- 前端展示：✓ 事实核验通过 / ⚠ 事实核验存疑
- 降级处理：API Key 未配置时默认 `score=0.5, passed=True`

### 4.10 Agent Service — Ingestion Pipeline

**文件**：`agent-service/app/ingestion/pipeline.py`

**完整管线**：

```
文件上传 → MinIO 存储
  → document_loader (pypdf/TextLoader, PDF/TXT/MD 解析)
  → text_splitter (RecursiveCharacterTextSplitter, chunk_size=500, overlap=50)
  → vector_ingest:
      - Embedding 嵌入 (local/OpenAI)
      - Milvus upsert (collection=bga_{project_id})
  → entity_extractor:
      - LLM 抽取实体+关系 (JSON格式)
      - 实体: {name, category, description}
      - 关系: {source, target, type(FLOW_TO/DEPENDS_ON/RELATES_TO), description, step_order}
  → graph_ingest:
      - Neo4j MERGE 实体节点
      - Neo4j MERGE RELATES_TO 关系边
```

> **注意**：当前 `graph_ingest.py` 中 `ingest_entities()` 方法仅创建 `RELATES_TO` 关系类型，`FLOW_TO` 和 `DEPENDS_ON` 关系类型虽然在 `entity_extractor` 中被抽取，但写入图谱时统一映射为 `RELATES_TO`。后续可扩展 `graph_ingest` 根据 `type` 字段动态创建不同关系类型。

**Pipeline 摄取端点**（`/api/v1/ingest/pipeline`）：

- 接收 `PipelineIngestRequest`：`file_url`（MinIO 预签名地址）、`mime_type`、`original_name`
- 通过 `httpx.AsyncClient` 下载文件到临时目录
- 智能推断文件扩展名：`mime_type` → `original_name` → URL 路径 → 默认 `.pdf`
- 调用 `ingest_full_pipeline()` 完成向量化 + 图谱构建
- 清理临时文件

### 4.11 Agent Service — IngestWorker（后台摄取）

**文件**：`agent-service/app/ingestion/ingest_worker.py`

**触发条件**：`NODE_ENV=production` 时，FastAPI `lifespan` 中启动 IngestWorker 后台线程。

**工作流程**：

```
IngestWorker.start()
  → while running:
    → Redis SCAN ingest:queue:* (批量50)
    → 读取 ingest:pending:{document_id} 获取 payload (JSON)
    → _process_document(payload):
      → _download_from_minio(storage_key) (boto3 S3 下载)
      → ingest_to_milvus() (向量化写入 Milvus)
      → 清理临时文件
    → Redis DEL ingest:queue:{document_id}
    → Redis DEL ingest:pending:{document_id}
    → sleep(2) (无任务时)
```

**Redis 键设计**：

| 键模式 | 类型 | 内容 |
|--------|------|
| `ingest:queue:{document_id}` | String | 标记待处理任务（SCAN 目标） |
| `ingest:pending:{document_id}` | String | JSON payload（projectId, storageKey） |

### 4.12 Agent Service — Prompt 安全

**文件**：`agent-service/app/prompt/injection_guard.py`

**防护措施**：

| 检测项 | 正则模式 |
|--------|----------|
| 忽略指令 | `ignore\s+(all\s+)?previous\s+(instructions\|prompts)` |
| 遗忘指令 | `forget\s+(all\s+)?previous` |
| 角色切换 | `you\s+are\s+now\s+a` |
| 系统注入 | `system\s*:\s*` / `<\s*/?\s*(system\|instruction\|prompt)\s*>` |
| 越狱 | `jailbreak` |
| 命令注入 | `sudo\s+` / `rm\s+-rf` / `DROP\s+TABLE` / `;\s*--` |

**处理**：`check_injection()` 检测 → `sanitize_input()` 清除 HTML 标签和控制字符。

### 4.13 Agent Service — 健康检查

**端点**：`GET /health`

**检查项**：

| 服务 | 检查方式 |
|------|----------|
| Milvus | `MilvusClient.list_collections()` |
| Neo4j | `driver.session().run("RETURN 1").consume()` |
| Redis | `redis.Redis.ping()` |

**返回**：`{ status: "ok" | "degraded", version: "0.1.0", checks: { milvus, neo4j, redis } }`

> **注意**：Agent Service 代码中版本号仍为 `0.1.0`（`main.py` 中硬编码），文档版本号 v0.3.0 为技术方案迭代版本，两者含义不同。

### 4.14 Agent Service — 调试端点

**端点**：`POST /api/v1/debug/retrieval`

**功能**：调试向量检索效果，返回集合信息 + 检索结果。

**请求**：`{ project_id, query, top_k=5 }`

**返回**：

```json
{
  "collection": { "name", "exists", "row_count" },
  "all_collections": [...],
  "search_results": [{ content, source, chunk_index, score }],
  "milvus_host", "milvus_port",
  "embedding_provider", "embedding_model", "embedding_dimension"
}
```

D---

## 5. 数据模型

### 5.1 PostgreSQL 实体

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Project    │     │   Document   │     │  ChatSession │
├──────────────┤     ├──────────────┤     ├──────────────┤
│ id (UUID)    │←────│ projectId    │     │ id (UUID)    │
│ name         │     │ id (UUID)    │     │ projectId    │
│ description  │     │ originalName │     │ userId       │
│ isActive     │     │ storageKey   │     │ title        │
│ config (JSON)│     │ mimeType     │     │ createdAt    │
│ milvusColl   │     │ fileSize     │     └──────────────┘
│ neo4jLabel   │     │ chunkCount   │            │
│ createdAt    │     │ ingestStatus │     ┌──────┴───────┐
│ updatedAt    │     │ ingestError  │     │  ChatMessage  │
└──────────────┘     │ createdAt    │     ├──────────────┤
                     └──────────────┘     │ id (UUID)    │
                                          │ sessionId    │
                                          │ role         │
                                          │ content      │
                                          │ metadata(JSON)│
                                          │ createdAt    │
                                          └──────────────┘
```

### 5.2 Milvus 向量集合

- 集合名：`bga_{project_id}`（UUID 中 `-` 替换为 `_`，如 `bga_966ce4f1_b36a_4e9c_813c_343cca323caa`）
- 字段：
  - `id` (INT64, 主键, 自增)
  - `vector` (FLOAT_VECTOR, dim=384/1536)
  - `content` (VARCHAR, 65535)
  - `source` (VARCHAR, 1024)
  - `chunk_index` (INT64)

### 5.3 Neo4j 图谱

- 节点标签：`Entity`
  - 属性：`project_id`, `name`, `category`, `description`
- 关系类型：
  - `FLOW_TO`：业务流转（step_order 排序）
  - `DEPENDS_ON`：依赖关系
  - `RELATES_TO`：一般关联
- 项目隔离：所有节点通过 `project_id` 属性过滤

> **当前限制**：`graph_ingest.ingest_entities()` 写入关系时统一使用 `RELATES_TO`，`FLOW_TO` 和 `DEPENDS_ON` 需后续扩展支持。

---

## 6. 接口设计

### 6.1 Backend REST API

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/auth/register | 用户注册 |
| POST | /api/v1/auth/login | 用户登录 |
| GET | /api/v1/auth/users | 获取用户列表 |
| GET | /api/v1/projects | 获取项目列表 |
| POST | /api/v1/projects | 创建项目 |
| GET | /api/v1/projects/:id | 获取项目详情 |
| PUT | /api/v1/projects/:id | 更新项目 |
| DELETE | /api/v1/projects/:id | 删除项目 |
| POST | /api/v1/documents/upload | 上传文档 |
| POST | /api/v1/documents/upload-screenshot | 上传截图 |
| GET | /api/v1/documents/project/:projectId | 获取项目文档列表 |
| POST | /api/v1/documents/:id/ingest | 触发文档摄取 |
| DELETE | /api/v1/documents/:id | 删除文档 |
| POST | /api/v1/chat/sessions | 创建会话 |
| GET | /api/v1/chat/sessions/project/:projectId | 获取项目会话 |
| GET | /api/v1/chat/sessions/:sessionId/messages | 获取会话消息 |
| POST | /api/v1/chat/messages | 非流式发送消息 |
| **POST** | **/api/v1/chat/stream** | **SSE 流式对话** |
| POST | /api/v1/knowledge | 创建知识库 |
| GET | /api/v1/knowledge/project/:projectId | 获取项目知识库 |
| GET | /api/v1/health | 健康检查 |

### 6.2 Agent Service API

所有路由前缀：`/api/v1`

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/chat | Agent 对话（非流式） |
| **POST** | **/api/v1/chat/stream** | **Agent 对话（SSE 流式）** |
| POST | /api/v1/ingest/vector | 向量化摄取（仅 Milvus） |
| POST | /api/v1/ingest/full | 完整摄取（向量 + 图谱） |
| POST | /api/v1/ingest/graph | 图谱摄取（仅 Neo4j） |
| **POST** | **/api/v1/ingest/pipeline** | **Pipeline 摄取（从 MinIO URL 下载 + 完整管线）** |
| POST | /api/v1/debug/retrieval | 调试向量检索 |
| GET | /health | 健康检查（Milvus/Neo4j/Redis 连通性） |

### 6.3 SSE 事件格式

**Agent Service → Backend → Frontend SSE 事件**：

```
data: {"type":"token","content":"根据"}          # 流式 token
data: {"type":"answer","content":"根据..."}       # 完整回答（非流式回退）
data: {"type":"intent","data":{"intent":"general_query","intent_confidence":0.99}}
data: {"type":"hallucination","data":{"hallucination_score":0.1,"hallucination_passed":true}}
data: {"type":"error","content":"..."}            # 错误事件
data: [DONE]                                     # 流结束
```

**Backend → Frontend 额外事件**：

```
data: {"type":"user_message","id":"...","content":"你好"}  # 用户消息确认
```

---

## 7. 部署架构

### 7.1 Docker Compose 服务编排

| 服务 | 镜像 | 端口映射 | 依赖 |
|------|------|----------|------|
| postgres | postgres:16-alpine | 15432:5432 | — |
| redis | redis:7-alpine | 16379:6379 | — |
| milvus-etcd | quay.io/coreos/etcd:v3.5.14 | — | — |
| milvus-minio | minio/minio:latest | — | — |
| milvus-standalone | milvusdb/milvus:v2.4.14 | 19530:19530, 9091:9091 | etcd, minio |
| neo4j | neo4j:5.21-community | 7474:7474, 7687:7687 | — |
| minio | minio/minio:latest | 9000:9000, 9001:9001 | — |
| backend | 自建 (node:22-alpine, 多阶段构建) | 3000:3000 | postgres, redis, milvus, neo4j, minio |
| agent-service | 自建 (python:3.11-slim, 预装 Embedding 模型) | 8000:8000 | milvus, neo4j, redis |
| frontend | 自建 (nginx:alpine, 多阶段构建) | 8888:80 | backend |

### 7.2 Docker 镜像构建

**Backend Dockerfile**：多阶段构建
- Stage 1 (builder)：`node:22-alpine`，`npm ci` + `npm run build`
- Stage 2 (runner)：`node:22-alpine`，`npm ci --omit=dev` + 复制 dist

**Agent Service Dockerfile**：
- Base：`python:3.11-slim`
- 安装系统依赖：`curl`
- 安装 Python 依赖：`pip install -r requirements.txt`
- **预装 Embedding 模型**：`SentenceTransformer('all-MiniLM-L6-v2')` 在构建时下载，避免运行时延迟
- 启动命令：`uvicorn app.main:app --host 0.0.0.0 --port 8000`

**Frontend Dockerfile**：多阶段构建
- Stage 1 (builder)：`node:22-alpine`，`npm ci` + `npm run build` (lib 模式)
- Stage 2 (runner)：`nginx:alpine`，复制 dist 到 `/usr/share/nginx/html`

### 7.3 网络拓扑

```
Host Machine
  ├── localhost:5173  → Vite Dev Server (ChatWidget 开发模式)
  ├── localhost:3000  → Backend (NestJS)
  ├── localhost:8000  → Agent Service (FastAPI)
  ├── localhost:8888  → Frontend (Nginx 静态部署)
  ├── localhost:15432 → PostgreSQL
  ├── localhost:16379 → Redis
  ├── localhost:19530 → Milvus
  ├── localhost:7474  → Neo4j Browser
  ├── localhost:7687  → Neo4j Bolt
  ├── localhost:9000  → MinIO API
  └── localhost:9001  → MinIO Console
```

> **Docker 网络注意**：容器间通过 Docker 内部网络通信，使用服务名和内部端口（如 `redis:6379`、`postgres:5432`）。`.env.example` 中 `REDIS_PORT=16379` 为宿主机映射端口，Docker Compose 环境下应改为 `6379`（内部端口）。同理 `POSTGRES_PORT` 应为 `5432`。

### 7.4 Makefile 常用命令

| 命令 | 说明 |
|------|------|
| `make up` | 启动所有服务（后台） |
| `make down` | 停止所有服务 |
| `make build` | 构建所有镜像 |
| `make rebuild` | 重新构建并启动 |
| `make logs` | 查看所有服务日志 |
| `make ps` | 查看服务状态 |
| `make test` | 运行所有测试（Backend + Agent） |
| `make lint` | 代码检查（ESLint + Ruff + TypeScript） |
| `make dev-backend` | 本地开发 Backend |
| `make dev-agent` | 本地开发 Agent Service |
| `make dev-frontend` | 本地开发前端组件 |
| `make check-infra` | 检查基础设施连通性（Milvus/Neo4j/Redis 等） |
| `make init` | 初始化项目（安装 Backend/Frontend/Agent 依赖 + 复制 .env；Admin 需单独 `cd admin && npm install`） |
| `make clean` | 清理构建产物和容器 |

---

## 8. 安全设计

| 层面 | 措施 |
|------|------|
| 认证 | JWT Token + NestJS Guard |
| Prompt 注入 | 正则模式检测 + 输入清洗（`injection_guard.py`） |
| CORS | `Access-Control-Allow-Origin: *`（开发环境），生产环境应限制域名 |
| API Key | LLM API Key 存储在 `.env`，不暴露到前端 |
| 文件上传 | MinIO 私有存储，通过 Backend 预签名 URL 访问 |
| SQL 注入 | TypeORM 参数化查询 |
| 项目隔离 | projectId 贯穿全链路，Milvus 集合 / Neo4j 标签 / PostgreSQL 外键均按项目隔离 |
| 输入清洗 | `sanitize_input()` 清除 HTML 标签 + 控制字符 |

---

## 9. 性能优化

| 优化点 | 方案 |
|--------|------|
| SSE 流式 | 逐 token 流式返回，用户无需等待完整回答 |
| 流式中止 | AbortController 支持用户主动终止流式输出，节省资源 |
| 向量索引 | IVF_FLAT (nlist=128)，检索 nprobe=10，平衡精度与速度 |
| 本地 Embedding | sentence-transformers 本地推理，避免 Embedding API 调用延迟 |
| Embedding 预装 | Docker 构建时预下载 all-MiniLM-L6-v2 模型，避免运行时冷启动 |
| Redis 缓存 | 相同问题缓存 Agent 响应（TTL 300s） |
| 连接池 | Milvus/Neo4j/PostgreSQL 均使用连接池 |
| 前端 | Vue 3 响应式细粒度更新，shallowRef 避免深度代理 |
| 后台摄取 | IngestWorker 异步处理，不阻塞 API 请求 |

---

## 10. 可扩展性设计

| 扩展点 | 当前实现 | 扩展方式 |
|--------|----------|----------|
| LLM 提供商 | OpenAI 兼容 API（智谱/DeepSeek/OpenAI） | 修改 `LLM_BASE_URL` + `LLM_MODEL` 即可切换 |
| Embedding 提供商 | openai (text-embedding-3-small) / local (all-MiniLM-L6-v2) | `EMBEDDING_PROVIDER` 配置切换 |
| 意图类别 | 5 类 | 修改 `intent_recognition.py` Prompt + `INTENT_STRATEGY_MAP` |
| 检索策略 | vector / graph / hybrid | 在 `retrieval_router.py` 添加新策略 + 新检索节点 |
| Agent 节点 | 8 节点 | LangGraph `add_node` + `add_edge` 扩展工作流 |
| 前端嵌入 | ChatWidget 独立组件 | `npm run build` 生成 lib，`<script>` 引入即可 |
| 多项目 | projectId 隔离 | 新建项目自动创建独立 Milvus 集合 + Neo4j 标签空间 |
| 图谱关系类型 | 写入统一为 RELATES_TO | 扩展 `graph_ingest.py` 根据 `type` 字段动态创建 FLOW_TO/DEPENDS_ON |

---

## 11. 监控与运维

| 维度 | 方案 |
|------|------|
| 健康检查 | GET /api/v1/health（Backend）、GET /health（Agent，含 Milvus/Neo4j/Redis 连通性检查） |
| Docker 健康检查 | postgres: `pg_isready`，redis: `redis-cli ping`，milvus: `curl healthz`，neo4j: `wget /`，minio: `mc ready` |
| 日志 | NestJS Logger + Python logging，`LOG_LEVEL` 可配置 |
| API 文档 | Swagger UI: http://localhost:3000/api/docs（Backend），Agent Service OpenAPI: http://localhost:8000/docs |
| 摄取状态 | Document.ingestStatus: pending → processing → completed / failed |
| 调试检索 | POST /api/v1/debug/retrieval（查看集合信息 + 检索结果） |
| CI/CD | GitHub Actions（.github/workflows/ci.yml）：Backend build+test，Agent test，Frontend typecheck+build，Lint |

### 11.1 CI/CD 流水线

**触发条件**：push to main/develop，PR to main

| Job | 步骤 |
|-----|------|
| backend | `npm ci` → `npm run build` → `npm test -- --passWithNoTests` |
| agent-service | `pip install -r requirements.txt` → `python -m pytest -v --tb=short \|\| true`（当前容忍测试失败） |
| frontend | `npm ci` → `npx tsc --noEmit` → `npm run build` |
| lint | Backend ESLint + Agent Ruff |

---

## 12. 项目目录结构

```
business-guide-agent/
├── .env                          # 环境变量（API Key、数据库连接等）
├── .env.example                  # 环境变量模板
├── .github/workflows/ci.yml      # CI/CD 流水线
├── docker-compose.yml            # 基础设施编排
├── Makefile                      # 常用命令快捷入口
├── SETUP.md                      # 新用户部署指南
├── TECHNICAL_SOLUTION.md         # 本文档
│
├── frontend/                     # 前端对话组件 (Vue 3, lib 模式构建)
│   ├── src/
│   │   ├── ChatWidget.vue        # 对话组件 (SFC + Composition API + 流式中止)
│   │   ├── api.ts                # API Client (SSE/REST, AbortSignal 支持)
│   │   ├── types.ts              # TypeScript 类型定义
│   │   ├── index.ts              # 导出入口
│   │   └── vite-env.d.ts         # Vite 类型声明
│   ├── index.html                # 主入口
│   ├── vite.config.ts            # Vite 配置 (lib模式)
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile                # Nginx 部署 (多阶段构建)
│
├── admin/                        # 管理后台 (Vue 3 + Vue Router SPA)
│   ├── src/
│   │   ├── main.ts               # 入口
│   │   ├── App.vue               # 根组件
│   │   ├── router.ts             # 路由 (Dashboard / ProjectDetail)
│   │   ├── api.ts                # API 封装 (Axios + 拦截器)
│   │   ├── composables/useToast.ts # Toast 通知
│   │   └── views/
│   │       ├── Dashboard.vue     # 项目管理 (创建/删除/列表)
│   │       └── ProjectDetail.vue # 文档管理 (上传/摄取/删除)
│   ├── index.html                # 入口
│   ├── vite.config.ts            # Vite 配置
│   └── package.json
│
├── backend/                      # 后端 (NestJS)
│   ├── src/
│   │   ├── app.module.ts         # 根模块
│   │   ├── main.ts               # 启动入口
│   │   ├── common/               # 公共: 过滤器、拦截器
│   │   ├── infrastructure/       # 基础设施: Milvus/Neo4j/Redis/MinIO
│   │   └── modules/              # 业务模块
│   │       ├── auth/             # 认证 (JWT + Guard)
│   │       ├── project/          # 项目管理
│   │       ├── document/         # 文档管理 + MinIO上传
│   │       ├── chat/             # 对话 (SSE流式 + Agent调用 + Redis缓存)
│   │       ├── knowledge/        # 知识库管理
│   │       └── health/           # 健康检查
│   ├── Dockerfile                # 多阶段构建
│   └── package.json
│
└── agent-service/                # Agent服务 (FastAPI + LangGraph)
    ├── app/
    │   ├── main.py               # FastAPI 入口 (lifespan: 启动 IngestWorker)
    │   ├── config/settings.py    # Pydantic Settings
    │   ├── api/routes.py         # API 路由 (chat/stream/ingest/debug)
    │   ├── graph/                # LangGraph 工作流
    │   │   ├── agent_graph.py    # 工作流构建 (8节点 + 条件边)
    │   │   ├── state.py          # AgentState 定义
    │   │   └── nodes/            # 工作流节点
    │   │       ├── vision_parser.py       # 截图分析 (多模态LLM)
    │   │       ├── intent_recognition.py  # 意图识别 (含 API Key 降级)
    │   │       ├── retrieval_router.py    # 检索路由 (INTENT_STRATEGY_MAP)
    │   │       ├── vector_retrieval.py    # 向量检索 (Milvus, 相关性过滤)
    │   │       ├── graph_retrieval.py     # 图谱检索 (Neo4j, 按意图分查询)
    │   │       ├── context_combiner.py    # 上下文合并 (向量+图谱)
    │   │       ├── answer_generation.py   # 回答生成 (async generator 流式)
    │   │       └── hallucination_check.py # 幻觉检测 (LLM-as-Judge)
    │   ├── ingestion/            # 文档摄取管线
    │   │   ├── pipeline.py       # 完整管线编排
    │   │   ├── document_loader.py # 文件解析 (PDF/TXT/MD)
    │   │   ├── text_splitter.py  # 文本分块 (中文分隔符优化)
    │   │   ├── vector_ingest.py  # 向量化 + Milvus写入
    │   │   ├── entity_extractor.py # LLM实体抽取 (JSON格式, 实体合并)
    │   │   ├── graph_ingest.py   # Neo4j图谱构建 (当前仅 RELATES_TO)
    │   │   └── ingest_worker.py  # 后台摄取工作线程 (Redis 队列轮询)
    │   ├── retrieval/            # 检索客户端
    │   │   ├── milvus_client.py  # Milvus 检索器 (Embedding + 搜索 + 插入)
    │   │   └── neo4j_client.py   # Neo4j 检索器 (流程查询 + 通用查询 + 实体写入)
    │   └── prompt/               # Prompt模板与安全
    │       ├── templates.py      # 系统Prompt模板 (意图/回答/幻觉/实体抽取)
    │       └── injection_guard.py # Prompt注入防护 (10种模式)
    ├── tests/                    # 测试
    │   ├── test_agent.py
    │   └── test_pipeline.py
    ├── Dockerfile                # Python 3.11-slim + 预装 Embedding 模型
    ├── requirements.txt          # Python 依赖
    └── pytest.ini                # Pytest 配置
```