# Business Guide Agent — 项目技术方案

> 版本：v0.2.0 | 更新日期：2026-09-10

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
| 流式对话 | SSE 实时流式输出，用户体验流畅 |
| 文档摄取 | 支持 PDF/TXT/MD 文档上传，自动分块 + 向量化 + 实体抽取 + 图谱构建 |

### 1.3 技术栈总览

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (Vue 3 + Vite + TypeScript)                       │
│  - ChatWidget.vue: 对话组件 (Composition API + SSE)         │
│  - admin.html: 管理后台 (项目/文档/摄取管理)                  │
├─────────────────────────────────────────────────────────────┤
│  Backend (NestJS + TypeORM + PostgreSQL)                    │
│  - REST API + SSE 流式接口                                  │
│  - Auth / Project / Document / Chat / Knowledge 模块        │
├─────────────────────────────────────────────────────────────┤
│  Agent Service (FastAPI + LangGraph + LangChain)            │
│  - 8 节点 Agent 工作流 (意图→路由→检索→回答→校验)            │
│  - Ingestion 管线 (分块→向量化→实体抽取→图谱构建)            │
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
                          │  │  intent_recognize│ │
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
                          └──┬──────┬──────┬─────┘
                             │      │      │
                    ┌────────┴┐  ┌─┴───┐ ┌┴────┐
                    │  Milvus  │  │Neo4j│ │ LLM │
                    │ (向量库) │  │(图谱)│ │(GPT)│
                    └─────────┘  └─────┘ └─────┘
```

### 2.2 数据流

**对话流程（SSE 流式）：**

```
用户输入 → Frontend → POST /api/v1/chat/stream
  → Backend ChatController (建立 SSE 连接)
    → ChatService.streamMessage()
      → HTTP POST → Agent Service /agent/chat
        → LangGraph Agent Workflow:
          1. vision_preprocess  (如有截图，调用多模态LLM分析)
          2. intent_recognition (LLM识别意图类别+置信度)
          3. retrieval_router   (意图→检索策略映射)
          4. vector_retrieval   (Milvus向量相似度检索)
          5. graph_retrieval    (Neo4j图谱关系查询) [可选]
          6. context_combiner   (合并多源检索结果)
          7. answer_generation  (LLM基于上下文生成回答)
          8. hallucination_check(LLM校验回答与上下文一致性)
        ← SSE 逐节点流式返回
      ← Backend 透传 SSE chunks
    ← Frontend 解析 SSE data 渲染
```

**文档摄取流程：**

```
上传文件 → Backend → MinIO 存储
  → POST /documents/:id/ingest
    → Agent Service /agent/ingest
      → document_loader  (PDF/TXT/MD 解析)
      → text_splitter    (递归字符分块, 500字/块, 50字重叠)
      → vector_ingest    (Embedding → Milvus 插入)
      → entity_extractor (LLM抽取实体+关系)
      → graph_ingest     (Neo4j 创建节点+边)
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

### 3.2 后端

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| NestJS | 10.4+ | 企业级 Node.js 框架，模块化架构，内置 DI/AOP/Guard，适合中大型后端 |
| TypeORM | 0.3+ | NestJS 官方推荐 ORM，支持 PostgreSQL，装饰器语法简洁 |
| PostgreSQL | 16 | 关系型主库，存储项目/文档/会话/消息等结构化数据 |
| Redis | 7 | 缓存 + 会话状态，Agent Service 调用结果缓存 |
| MinIO | latest | S3 兼容对象存储，存储上传的文档文件和截图 |

### 3.3 Agent Service

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| FastAPI | 0.111+ | 高性能异步 Python 框架，自动 OpenAPI 文档，适合 AI 服务 |
| LangGraph | 0.2+ | LangChain 工作流引擎，StateGraph 原生支持条件边、循环、状态管理 |
| LangChain | 0.2+ | LLM 应用开发框架，统一 Embedding/Chat/Retrieval 接口 |
| Pydantic | 2.7+ | 数据校验 + Settings 管理，类型安全的配置加载 |

### 3.4 向量数据库 & 知识图谱

| 技术 | 版本 | 选型依据 |
|------|------|----------|
| Milvus | 2.4+ | 云原生向量数据库，支持 IVF_FLAT/HNSW 索引，亿级向量检索 |
| Neo4j | 5.x | 原生图数据库，Cypher 查询语言，适合业务流程/实体关系建模 |

### 3.5 LLM

| 配置项 | 说明 |
|--------|------|
| LLM_PROVIDER | openai（兼容 OpenAI API 的任意提供商） |
| LLM_MODEL | 可配置（如 gpt-4o、deepseek-chat 等） |
| LLM_BASE_URL | 支持自定义 API 端点（如 guaihub.com/v1） |
| EMBEDDING_PROVIDER | local（sentence-transformers 本地嵌入）或 openai（API 嵌入） |

---

## 4. 模块详细设计

### 4.1 Frontend — ChatWidget.vue

**文件**：`frontend/src/ChatWidget.vue`

**技术方案**：Vue 3 SFC + Composition API (`<script setup>`)

**核心状态**：

```typescript
const open = ref(false)              // 面板开关
const messages = ref<ChatMsg[]>([])  // 消息列表
const input = ref("")                // 输入框
const loading = ref(false)           // 发送中
const sessionId = ref<string | null>(null)  // 会话ID
const streaming = ref(true)          // 流式开关
const screenshotUrl = ref<string>()  // 截图URL
const screenshotPreview = ref<string>() // 截图预览
const client = shallowRef(new ApiClient(config)) // API客户端(shallowRef避免响应式代理破坏class)
```

**关键设计**：

- `shallowRef` 包装 `ApiClient` 实例，避免 Vue 深度响应式代理破坏 class 的 `this` 绑定
- `uuid()` 兼容函数：优先 `crypto.randomUUID()`，不可用时回退 `Math.random()` 生成 UUID v4
- SSE 流式解析：`for await (const chunk of client.streamMessage(...))` 逐 chunk 解析 JSON，过滤 `intent`/`hallucination` 等内部事件，只渲染 `answer` 类型内容
- Markdown 渲染：`markdown-it` 渲染 assistant 消息，支持代码块、链接等
- 深色主题：通过 `isDark` computed 控制 CSS class 切换

### 4.2 Frontend — Admin Panel

**文件**：`frontend/admin.html`

**技术方案**：纯 HTML + Vanilla JS（无框架依赖，独立部署）

**功能**：
- 项目管理：创建/选择/删除项目
- 文档管理：上传（拖拽+点击）、删除、批量摄取
- 摄取状态：pending → processing → completed / failed 实时刷新

### 4.3 Frontend — API Client

**文件**：`frontend/src/api.ts`

**类设计**：`ApiClient`

| 方法 | 端点 | 说明 |
|------|------|------|
| `createSession(projectId)` | POST /api/v1/chat/sessions | 创建会话 |
| `sendMessage(sessionId, content, imageUrl?)` | POST /api/v1/chat/messages | 非流式发送 |
| `*streamMessage(sessionId, content, imageUrl?)` | POST /api/v1/chat/stream | SSE 流式发送（AsyncGenerator） |
| `uploadScreenshot(file)` | POST /api/v1/documents/upload-screenshot | 上传截图 |

**SSE 解析**：使用 `ReadableStream` + `TextDecoder` 逐块读取，按 `\n` 分行，提取 `data: ` 前缀内容，遇到 `[DONE]` 结束。

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
res.setHeader("X-Accel-Buffering", "no");

for await (const chunk of this.chatService.streamMessage(projectId, content, imageUrl)) {
  res.write(`data: ${chunk}\n\n`);
}
res.write("data: [DONE]\n\n");
res.end();
```

**ChatService.streamMessage()**：调用 Agent Service 的 `/agent/chat` 端点，透传 SSE 流。

### 4.5 Backend — Infrastructure Module

**文件**：`backend/src/infrastructure/`

| 服务 | 用途 |
|------|------|
| MilvusService | 向量数据库客户端（集合管理、索引创建） |
| Neo4jService | 图数据库客户端（Cypher 查询） |
| RedisService | 缓存 + 会话状态管理 |
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
│answer_generation │ ← LLM基于上下文生成回答
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

### 4.8 Agent Service — 双通道检索

**向量检索**（`MilvusRetriever`）：

- Embedding 模型：`sentence-transformers/all-MiniLM-L6-v2`（本地，384维）或 OpenAI Embedding
- 索引类型：`IVF_FLAT`，度量 `COSINE`
- 检索参数：`top_k=5`，`nprobe=10`
- 返回：`[{content, source, score, chunk_index}]`

**图谱检索**（`Neo4jRetriever`）：

- 按意图分两种 Cypher 查询：
  - `process_inquiry`：沿 `FLOW_TO`/`RELATES_TO`/`DEPENDS_ON` 边遍历流程链
  - 其他意图：按关键词匹配实体节点 + 关系
- 实体标签：`Entity`，属性 `project_id` 实现项目隔离
- 关系类型：`FLOW_TO`（流转）、`DEPENDS_ON`（依赖）、`RELATES_TO`（关联）

### 4.9 Agent Service — 幻觉检测

**文件**：`agent-service/app/graph/nodes/hallucination_check.py`

**方案**：LLM-as-Judge

- 将 `combined_context` 和 `answer` 发送给 LLM
- Prompt 要求判断回答是否与上下文一致
- LLM 返回 `pass` / `fail`
- 结果写入 `hallucination_score` 和 `hallucination_passed`
- 前端展示：✓ 事实核验通过 / ⚠ 事实核验存疑

### 4.10 Agent Service — Ingestion Pipeline

**文件**：`agent-service/app/ingestion/pipeline.py`

**完整管线**：

```
文件上传 → MinIO 存储
  → document_loader (pypdf/TextLoader/UnstructuredMarkdownLoader)
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
      - Neo4j MERGE 关系边
```

### 4.11 Agent Service — Prompt 安全

**文件**：`agent-service/app/prompt/injection_guard.py`

**防护措施**：

| 检测项 | 正则模式 |
|--------|----------|
| 忽略指令 | `ignore (all )?previous (instructions\|prompts)` |
| 角色切换 | `you are now a` |
| 系统注入 | `system:` / `<system>` |
| 越狱 | `jailbreak` |
| 命令注入 | `sudo` / `rm -rf` / `DROP TABLE` / `;--` |

**处理**：`check_injection()` 检测 → `sanitize_input()` 清除 HTML 标签和控制字符。

---

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
│ milvusColl   │     │ fileSize     │     └──────┬───────┘
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

- 集合名：`bga_{project_id}`（如 `bga_966ce4f1-b36a-4e9c-813c-343cca323caa`）
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

---

## 6. 接口设计

### 6.1 Backend REST API

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /api/v1/auth/register | 用户注册 |
| POST | /api/v1/auth/login | 用户登录 |
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

| 方法 | 路由 | 说明 |
|------|------|------|
| POST | /agent/chat | Agent 对话（SSE 流式） |
| POST | /agent/ingest | 文档摄取 |
| GET | /agent/health | 健康检查 |

### 6.3 SSE 事件格式

```
data: {"type":"user_message","id":"...","content":"你好"}
data: {"type":"intent","data":{"intent":"general_query","intent_confidence":0.99}}
data: {"type":"answer","content":"根据..."}
data: {"type":"hallucination","data":{"score":0.1,"passed":true}}
data: [DONE]
```

---

## 7. 部署架构

### 7.1 Docker Compose 服务编排

| 服务 | 镜像 | 端口映射 | 依赖 |
|------|------|----------|------|
| postgres | postgres:16-alpine | 15432:5432 | — |
| redis | redis:7-alpine | 16379:6379 | — |
| milvus-etcd | quay.io/coreos/etcd:v3.5.14 | — | — |
| milvus-minio | minio/minio:RELEASE2023-03-20 | — | — |
| milvus | milvusdb/milvus:v2.4.14 | 19530:19530 | etcd, minio |
| neo4j | neo4j:5 | 7474:7474, 7687:7687 | — |
| minio | minio/minio:RELEASE2023-03-20 | 9000:9000, 9001:9001 | — |
| backend | 自建 (node:22-alpine) | 3000:3000 | postgres, redis, milvus, neo4j, minio |
| agent-service | 自建 (python:3.11-slim) | 8000:8000 | milvus, neo4j, redis |
| frontend | 自建 (nginx:alpine) | 8888:80 | backend |

### 7.2 网络拓扑

```
Host Machine
  ├── localhost:5173  → Vite Dev Server (开发模式)
  ├── localhost:3000  → Backend (NestJS)
  ├── localhost:8000  → Agent Service (FastAPI)
  ├── localhost:15432 → PostgreSQL
  ├── localhost:16379 → Redis
  ├── localhost:19530 → Milvus
  ├── localhost:7687  → Neo4j
  └── localhost:9000  → MinIO
```

---

## 8. 安全设计

| 层面 | 措施 |
|------|------|
| 认证 | JWT Token + NestJS Guard |
| Prompt 注入 | 正则模式检测 + 输入清洗（`injection_guard.py`） |
| CORS | `Access-Control-Allow-Origin: *`（开发环境），生产环境应限制域名 |
| API Key | LLM API Key 存储在 `.env`，不暴露到前端 |
| 文件上传 | MinIO 私有存储，通过 Backend 签名 URL 访问 |
| SQL 注入 | TypeORM 参数化查询 |
| 项目隔离 | projectId 贯穿全链路，Milvus 集合 / Neo4j 标签 / PostgreSQL 外键均按项目隔离 |

---

## 9. 性能优化

| 优化点 | 方案 |
|--------|------|
| SSE 流式 | 逐节点流式返回，用户无需等待完整回答 |
| 向量索引 | IVF_FLAT (nlist=128)，检索 nprobe=10，平衡精度与速度 |
| 本地 Embedding | sentence-transformers 本地推理，避免 Embedding API 调用延迟 |
| Redis 缓存 | 相同问题缓存 Agent 响应（TTL 可配置） |
| 连接池 | Milvus/Neo4j/PostgreSQL 均使用连接池 |
| 前端 | Vue 3 响应式细粒度更新，shallowRef 避免深度代理 |

---

## 10. 可扩展性设计

| 扩展点 | 当前实现 | 扩展方式 |
|--------|----------|----------|
| LLM 提供商 | OpenAI 兼容 API | 修改 `LLM_BASE_URL` + `LLM_MODEL` 即可切换 |
| Embedding 提供商 | local / openai | `EMBEDDING_PROVIDER` 配置切换 |
| 意图类别 | 5 类 | 修改 `intent_recognition.py` Prompt + `INTENT_STRATEGY_MAP` |
| 检索策略 | vector / graph / hybrid | 在 `retrieval_router.py` 添加新策略 + 新检索节点 |
| Agent 节点 | 8 节点 | LangGraph `add_node` + `add_edge` 扩展工作流 |
| 前端嵌入 | ChatWidget 独立组件 | `npm run build` 生成 lib，`<script>` 引入即可 |
| 多项目 | projectId 隔离 | 新建项目自动创建独立 Milvus 集合 + Neo4j 标签空间 |

---

## 11. 监控与运维

| 维度 | 方案 |
|------|------|
| 健康检查 | GET /api/v1/health（Backend）、GET /agent/health（Agent） |
| Docker 健康检查 | postgres: `pg_isready`，redis: `redis-cli ping`，milvus: `wget health`，neo4j: `GET /` |
| 日志 | NestJS Logger + Python logging，`LOG_LEVEL` 可配置 |
| API 文档 | Swagger UI: http://localhost:3000/api/docs |
| 摄取状态 | Document.ingestStatus: pending → processing → completed / failed |

---

## 12. 项目目录结构

```
business-guide-agent/
├── .env                          # 环境变量（API Key、数据库连接等）
├── docker-compose.yml            # 基础设施编排
├── SETUP.md                      # 新用户部署指南
├── TECHNICAL_SOLUTION.md         # 本文档
│
├── frontend/                     # 前端 (Vue 3)
│   ├── src/
│   │   ├── ChatWidget.vue        # 对话组件 (SFC + Composition API)
│   │   ├── api.ts                # API Client (SSE/REST)
│   │   ├── types.ts              # TypeScript 类型定义
│   │   ├── index.ts              # 导出入口
│   │   └── vite-env.d.ts         # Vite 类型声明
│   ├── admin.html                # 管理后台 (纯HTML+JS)
│   ├── index.html                # 主入口
│   ├── vite.config.ts            # Vite 配置 (lib模式)
│   ├── tsconfig.json
│   ├── package.json
│   └── Dockerfile                # Nginx 部署
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
│   │       ├── chat/             # 对话 (SSE流式 + Agent调用)
│   │       ├── knowledge/        # 知识库管理
│   │       └── health/           # 健康检查
│   ├── Dockerfile
│   └── package.json
│
└── agent-service/                # Agent服务 (FastAPI + LangGraph)
    ├── app/
    │   ├── main.py               # FastAPI 入口
    │   ├── config/settings.py    # Pydantic Settings
    │   ├── api/routes.py         # API 路由
    │   ├── graph/                # LangGraph 工作流
    │   │   ├── agent_graph.py    # 工作流构建 (8节点)
    │   │   ├── state.py          # AgentState 定义
    │   │   └── nodes/            # 工作流节点
    │   │       ├── vision_parser.py       # 截图分析 (多模态LLM)
    │   │       ├── intent_recognition.py  # 意图识别
    │   │       ├── retrieval_router.py    # 检索路由
    │   │       ├── vector_retrieval.py    # 向量检索 (Milvus)
    │   │       ├── graph_retrieval.py     # 图谱检索 (Neo4j)
    │   │       ├── context_combiner.py    # 上下文合并
    │   │       ├── answer_generation.py   # 回答生成 (LLM)
    │   │       └── hallucination_check.py # 幻觉检测
    │   ├── ingestion/            # 文档摄取管线
    │   │   ├── pipeline.py       # 完整管线编排
    │   │   ├── document_loader.py # 文件解析 (PDF/TXT/MD)
    │   │   ├── text_splitter.py  # 文本分块
    │   │   ├── vector_ingest.py  # 向量化 + Milvus写入
    │   │   ├── entity_extractor.py # LLM实体抽取
    │   │   └── graph_ingest.py   # Neo4j图谱构建
    │   ├── retrieval/            # 检索客户端
    │   │   ├── milvus_client.py  # Milvus检索器
    │   │   └── neo4j_client.py   # Neo4j检索器
    │   └── prompt/               # Prompt模板与安全
    │       ├── templates.py      # 系统Prompt模板
    │       └── injection_guard.py # Prompt注入防护
    ├── Dockerfile
    └── requirements.txt
```