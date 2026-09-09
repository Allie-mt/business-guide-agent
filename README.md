# Business Guide Agent - 智能业务指引助手

基于 **RAG（检索增强生成）** 架构的智能业务指引系统，结合向量检索（Milvus）和知识图谱（Neo4j），为不同项目的业务操作提供精准、可操作的指引回答。

---

## 目录

- [系统架构](#系统架构)
- [基础设施层](#基础设施层)
- [Backend（NestJS）](#backendnestjs)
  - [Auth 模块](#auth-模块)
  - [Project 模块](#project-模块)
  - [Document 模块](#document-模块)
  - [Chat 模块](#chat-模块)
  - [Knowledge 模块](#knowledge-模块)
  - [Health 模块](#health-模块)
  - [Infrastructure 模块](#infrastructure-模块)
- [Agent Service（FastAPI + LangGraph）](#agent-servicefastapi--langgraph)
  - [Config 配置](#config-配置)
  - [API 路由层](#api-路由层)
  - [Graph 工作流](#graph-工作流)
  - [Ingestion 摄取管线](#ingestion-摄取管线)
  - [Retrieval 检索客户端](#retrieval-检索客户端)
  - [Prompt 模板与安全](#prompt-模板与安全)
- [Frontend 前端](#frontend-前端)
  - [ChatWidget 对话组件](#chatwidget-对话组件)
  - [Admin 管理后台](#admin-管理后台)
  - [API Client](#api-client)
  - [Types 类型定义](#types-类型定义)
- [环境配置](#环境配置)
- [快速启动](#快速启动)
- [API 接口总览](#api-接口总览)

---

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend                              │
│  ┌──────────────────┐    ┌──────────────────────────────┐   │
│  │   ChatWidget.tsx  │    │       admin.html             │   │
│  │   (对话组件)       │    │   (项目/文档管理后台)         │   │
│  └────────┬─────────┘    └──────────────┬───────────────┘   │
└───────────┼─────────────────────────────┼───────────────────┘
            │ SSE / REST                  │ REST
            ▼                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend (NestJS :3000)                    │
│  ┌──────┐ ┌─────────┐ ┌──────────┐ ┌──────┐ ┌──────────┐  │
│  │ Auth │ │ Project  │ │ Document │ │ Chat │ │ Knowledge│  │
│  └──────┘ └────┬────┘ └────┬─────┘ └──┬───┘ └────┬─────┘  │
│                │           │           │           │         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │            Infrastructure (Milvus/Neo4j/Redis/MinIO)│   │
│  └─────────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP (Agent Service 调用)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                Agent Service (FastAPI :8000)                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              LangGraph Agent Workflow                │   │
│  │  vision → intent → router → retrieval → combine     │   │
│  │         → answer → hallucination_check              │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │
│  │  Ingestion   │  │  Retrieval   │  │  Prompt Guard  │   │
│  │  (摄取管线)   │  │  (检索客户端) │  │  (模板与安全)   │   │
│  └──────────────┘  └──────────────┘  └────────────────┘   │
└─────────────────────────────────────────────────────────────┘
            │                │               │
            ▼                ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Docker Compose 基础设施                    │
│  PostgreSQL │ Redis │ Milvus (+etcd+minio) │ Neo4j │ MinIO │
└─────────────────────────────────────────────────────────────┘
```

**数据流：**

1. 用户在 ChatWidget 中输入问题
2. Frontend 通过 SSE 调用 Backend `/api/v1/chat/stream`
3. Backend 保存用户消息，转发请求到 Agent Service `/api/v1/chat/stream`
4. Agent Service 执行 LangGraph 工作流：意图识别 → 检索路由 → 向量/图谱检索 → 上下文合并 → 答案生成 → 幻觉检查
5. 结果通过 SSE 流式返回 Frontend

---

## 基础设施层

**文件：** `docker-compose.yml`

通过 Docker Compose 编排以下服务：

| 服务 | 镜像 | 端口映射 | 用途 |
|------|------|----------|------|
| **PostgreSQL** | `postgres:16-alpine` | `15432:5432` | 主数据库，存储项目/文档/会话等业务数据 |
| **Redis** | `redis:7-alpine` | `16379:6379` | 缓存、会话存储、摄取任务队列 |
| **Milvus** | `milvusdb/milvus:v2.4.14` | `19530:19530` | 向量数据库，存储文档嵌入向量 |
| ├ etcd | `quay.io/coreos/etcd:v3.5.14` | — | Milvus 元数据存储 |
| └ minio | `minio/minio:latest` | — | Milvus 内部对象存储 |
| **Neo4j** | `neo4j:5.21-community` | `17474:7474`, `17687:7687` | 知识图谱数据库，存储业务实体关系 |
| **MinIO** | `minio/minio:latest` | `9000:9000`, `9001:9001` | 对象存储，存储上传的文档文件和截图 |

> **注意：** 端口映射使用非默认端口（如 15432、16379）以避免与本地已有服务冲突。

---

## Backend（NestJS）

**目录：** `backend/`  
**框架：** NestJS + TypeORM + PostgreSQL  
**入口：** `backend/src/main.ts`  
**全局前缀：** `/api/v1`

### 启动流程

`main.ts` 完成以下初始化：

1. 创建 NestJS 应用
2. 设置全局路由前缀 `/api/v1`
3. 注册全局 ValidationPipe（参数校验 + 白名单过滤）
4. 注册全局异常过滤器 `AllExceptionsFilter`
5. 注册全局拦截器 `LoggingInterceptor`（日志）和 `TransformInterceptor`（响应包装）
6. 启用 CORS
7. 配置 Swagger 文档（访问 `/api/v1/docs`）
8. 监听端口 `BACKEND_PORT`（默认 3000）

### Auth 模块

**目录：** `backend/src/modules/auth/`

用户认证与授权模块，基于 JWT 实现。

| 文件 | 职责 |
|------|------|
| `auth.controller.ts` | 认证路由控制器 |
| `auth.service.ts` | 认证业务逻辑（注册/登录/JWT 签发） |
| `auth.module.ts` | 模块定义 |
| `user.entity.ts` | 用户实体 |
| `dto/auth.dto.ts` | 请求 DTO（RegisterDto / LoginDto） |
| `guards/auth.guards.ts` | JWT 认证守卫 |
| `decorators/roles.decorator.ts` | 角色装饰器 |

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 用户注册，返回 user + token |
| POST | `/api/v1/auth/login` | 用户登录，返回 user + token |
| GET | `/api/v1/auth/users` | 获取用户列表（需 JWT 认证） |

**实体字段（User）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| username | string | 用户名（唯一） |
| email | string | 邮箱（唯一） |
| password | string | 密码（bcrypt 加密） |
| role | enum | 角色：admin / user |

---

### Project 模块

**目录：** `backend/src/modules/project/`

项目隔离的核心模块，每个项目拥有独立的 Milvus Collection 和 Neo4j 标签，实现知识库数据隔离。

| 文件 | 职责 |
|------|------|
| `project.controller.ts` | 项目 CRUD 路由 |
| `project.service.ts` | 项目业务逻辑 |
| `project.module.ts` | 模块定义 |
| `project.entity.ts` | 项目实体 |
| `dto/create-project.dto.ts` | 创建项目 DTO |
| `dto/update-project.dto.ts` | 更新项目 DTO |

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects` | 创建项目 |
| GET | `/api/v1/projects` | 获取所有项目 |
| GET | `/api/v1/projects/:id` | 获取单个项目 |
| PUT | `/api/v1/projects/:id` | 更新项目 |
| DELETE | `/api/v1/projects/:id` | 删除项目 |

**实体字段（Project）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | string | 项目名称（唯一） |
| description | string | 项目描述 |
| isActive | boolean | 是否启用 |
| config | JSON | 项目配置 |
| milvusCollectionName | string | Milvus 集合名（自动生成：`bga_{name}`） |
| neo4jLabel | string | Neo4j 标签名（自动生成：`{NAME}`） |

**关键逻辑：** 创建项目时自动生成 `milvusCollectionName`（`bga_{name_lowercase}`）和 `neo4jLabel`（`{NAME_UPPERCASE}`），用于 Agent Service 的数据隔离。

---

### Document 模块

**目录：** `backend/src/modules/document/`

文档上传、存储和摄取管理模块。文档上传到 MinIO 后自动触发摄取流程。

| 文件 | 职责 |
|------|------|
| `document.controller.ts` | 文档管理路由 |
| `document.service.ts` | 文档业务逻辑 |
| `document.module.ts` | 模块定义 |
| `document.entity.ts` | 文档实体 |
| `dto/upload-document.dto.ts` | 上传 DTO |

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/documents/upload` | 上传文档（multipart/form-data，字段：file + projectId） |
| POST | `/api/v1/documents/upload-screenshot` | 上传截图（用于多模态对话） |
| GET | `/api/v1/documents/project/:projectId` | 获取项目下所有文档 |
| GET | `/api/v1/documents/:id` | 获取文档详情 |
| GET | `/api/v1/documents/:id/download` | 获取文档下载链接（MinIO 预签名 URL） |
| POST | `/api/v1/documents/:id/ingest` | 手动触发文档摄取 |
| DELETE | `/api/v1/documents/:id` | 删除文档 |

**实体字段（Document）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| projectId | UUID | 所属项目 |
| originalName | string | 原始文件名 |
| storageKey | string | MinIO 存储路径 |
| mimeType | string | MIME 类型 |
| fileSize | number | 文件大小（字节） |
| chunkCount | number | 分块数量 |
| ingestStatus | enum | 摄取状态：pending / processing / completed / failed |
| ingestError | string | 摄取错误信息 |

**摄取流程：**

1. 文件上传到 MinIO（路径：`projects/{projectId}/documents/{timestamp}_{filename}`）
2. 创建 Document 记录（状态：pending）
3. 将摄取任务入队 Redis（`ingest:queue:{documentId}`）
4. Agent Service 的 IngestWorker 轮询 Redis 队列
5. 调用摄取管线：文档加载 → 文本分块 → 向量嵌入写入 Milvus → 实体抽取写入 Neo4j
6. 回调 Backend 更新摄取状态

---

### Chat 模块

**目录：** `backend/src/modules/chat/`

对话核心模块，管理会话和消息，支持 SSE 流式对话。

| 文件 | 职责 |
|------|------|------|
| `chat.controller.ts` | 会话和消息路由 |
| `chat.service.ts` | 对话业务逻辑 |
| `chat.module.ts` | 模块定义 |
| `chat-session.entity.ts` | 会话实体 |
| `chat-message.entity.ts` | 消息实体 |
| `dto/chat.dto.ts` | 请求 DTO |

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat/sessions` | 创建会话（需 projectId） |
| GET | `/api/v1/chat/sessions/project/:projectId` | 获取项目下所有会话 |
| GET | `/api/v1/chat/sessions/:sessionId/messages` | 获取会话消息列表 |
| POST | `/api/v1/chat/messages` | 发送消息（非流式） |
| POST | `/api/v1/chat/stream` | 流式对话（SSE） |

**DTO 定义：**

- **CreateSessionDto：** `projectId`（UUID, 必填）、`userId`（可选）、`title`（可选）
- **SendMessageDto：** `sessionId`（UUID, 必填）、`content`（string, 必填）、`imageUrl`（可选）

**SSE 流式对话流程：**

1. 设置 SSE 响应头（`Content-Type: text/event-stream`）
2. 验证会话存在
3. 保存用户消息到数据库
4. 发送 `user_message` SSE 事件
5. 调用 Agent Service 流式接口，逐 chunk 转发 SSE 事件
6. 发送 `[DONE]` 结束标记

**缓存机制：** ChatService 使用 Redis 缓存 Agent Service 的响应结果，相同 projectId + query 的请求直接返回缓存。

**实体字段：**

- **ChatSession：** id, projectId, userId, title, createdAt, updatedAt
- **ChatMessage：** id, sessionId, role（user/assistant）, content, metadata（JSON，含 intent/citations/hallucination 等）, createdAt

---

### Knowledge 模块

**目录：** `backend/src/modules/knowledge/`

知识库管理模块，提供向量库和知识图谱的统计查询。

| 文件 | 职责 |
|------|------|------|
| `knowledge.controller.ts` | 知识库路由 |
| `knowledge.service.ts` | 知识库业务逻辑 |
| `knowledge.module.ts` | 模块定义 |
| `knowledge-base.entity.ts` | 知识库实体 |
| `dto/knowledge-base.dto.ts` | 请求 DTO |

**API 接口：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/knowledge` | 创建知识库 |
| GET | `/api/v1/knowledge/project/:projectId` | 获取项目下知识库列表 |
| GET | `/api/v1/knowledge/:id` | 获取知识库详情 |
| GET | `/api/v1/knowledge/:id/graph-stats` | 获取知识图谱统计（实体数量/标签分布） |
| GET | `/api/v1/knowledge/:id/vector-stats` | 获取向量库统计（集合名/文档数量） |
| DELETE | `/api/v1/knowledge/:id` | 删除知识库 |

**实体字段（KnowledgeBase）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| projectId | UUID | 所属项目 |
| name | string | 知识库名称 |
| description | string | 描述 |
| type | enum | 类型：vector / graph / hybrid |
| documentCount | number | 文档数量 |
| entityCount | number | 实体数量 |
| isActive | boolean | 是否启用 |

**统计查询实现：**

- `getGraphStats`：执行 Cypher 查询 `MATCH (e:Entity {project_id: $projectId}) RETURN labels(e), count(e)`
- `getVectorStats`：调用 Milvus SDK `getCollectionStatistics` 获取行数

---

### Health 模块

**目录：** `backend/src/modules/health/`

系统健康检查模块。

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查（返回 status/timestamp/service/version） |
| GET | `/api/v1/health/ready` | 就绪检查 |

---

### Infrastructure 模块

**目录：** `backend/src/infrastructure/`

全局基础设施模块，封装外部服务客户端，供业务模块注入使用。

| 子模块 | 职责 |
|--------|------|
| **MilvusModule** | Milvus 向量数据库客户端（连接/集合管理/搜索） |
| **Neo4jModule** | Neo4j 图数据库客户端（Cypher 查询执行） |
| **RedisModule** | Redis 缓存客户端（get/set/del/过期管理） |
| **MinioModule** | MinIO 对象存储客户端（上传/下载/预签名 URL） |

该模块标记为 `@Global()`，所有业务模块可直接注入使用，无需显式导入。

---

## Agent Service（FastAPI + LangGraph）

**目录：** `agent-service/`  
**框架：** FastAPI + LangGraph + LangChain  
**入口：** `agent-service/app/main.py`  
**API 前缀：** `/api/v1`

### 启动流程

`main.py` 完成以下初始化：

1. 创建 FastAPI 应用
2. 配置 CORS（允许所有来源）
3. 注册 API 路由（`/api/v1` 前缀）
4. 在 production 模式下启动 IngestWorker 后台线程
5. 注册 `/health` 健康检查端点（检测 Milvus/Neo4j/Redis 连通性）

---

### Config 配置

**文件：** `agent-service/app/config/settings.py`

基于 `pydantic-settings` 的配置管理，自动从 `.env` 文件加载。

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | development | 运行环境 |
| `LLM_PROVIDER` | openai | LLM 提供商 |
| `LLM_MODEL` | gpt-4o | LLM 模型名 |
| `LLM_API_KEY` | "" | LLM API Key |
| `LLM_BASE_URL` | https://api.openai.com/v1 | LLM API 地址 |
| `LLM_TEMPERATURE` | 0.1 | 生成温度 |
| `EMBEDDING_PROVIDER` | openai | 嵌入模型提供商（openai / local） |
| `EMBEDDING_MODEL` | text-embedding-3-small | 嵌入模型名（local 模式可用 all-MiniLM-L6-v2） |
| `EMBEDDING_DIMENSION` | 1536 | 嵌入维度 |
| `MILVUS_HOST` | localhost | Milvus 地址 |
| `MILVUS_PORT` | 19530 | Milvus 端口 |
| `NEO4J_URI` | bolt://localhost:7687 | Neo4j 连接地址 |
| `REDIS_HOST` | localhost | Redis 地址 |

---

### API 路由层

**文件：** `agent-service/app/api/routes.py`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat` | 非流式对话，执行完整 LangGraph 工作流后返回 |
| POST | `/api/v1/chat/stream` | 流式对话（SSE），逐步推送工作流事件 |
| POST | `/api/v1/ingest/vector` | 仅向量摄取（文档 → 分块 → 嵌入 → Milvus） |
| POST | `/api/v1/ingest/full` | 联合摄取（向量 + 知识图谱） |
| POST | `/api/v1/ingest/pipeline` | 完整摄取管线（支持文件 URL 下载） |
| POST | `/api/v1/ingest/graph` | 仅图谱摄取（实体 → Neo4j） |

**请求模型：**

- **ChatRequest：** `project_id`（必填）、`query`（必填）、`image_url`（可选）
- **StreamRequest：** 同 ChatRequest
- **IngestRequest：** `project_id`、`file_path`、`chunk_size`（默认 500）、`chunk_overlap`（默认 50）、`extract_graph`（默认 true）
- **PipelineIngestRequest：** `project_id`、`file_url`（MinIO 预签名地址）、`document_id`（可选，用于回调）

**安全检查：** 所有 chat 请求先经过 `check_injection()` 检测提示注入攻击，检测到则返回 400 错误。

**SSE 流式事件类型：**

| 事件 | 说明 |
|------|------|
| `{"type": "answer", "content": "..."}` | 生成的答案片段 |
| `{"type": "intent", "data": {...}}` | 意图识别结果 |
| `{"type": "hallucination", "data": {...}}` | 幻觉检查结果 |
| `[DONE]` | 流结束标记 |

---

### Graph 工作流

**目录：** `agent-service/app/graph/`

基于 LangGraph 的 StateGraph 实现的智能对话工作流。

#### State 状态定义

**文件：** `agent-service/app/graph/state.py`

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]  # 消息历史
    project_id: str                  # 项目ID（数据隔离）
    query: str                       # 用户提问
    image_url: str | None            # 截图URL
    intent: str | None               # 识别的意图
    intent_confidence: float         # 意图置信度
    retrieval_strategy: str | None   # 检索策略：vector / graph / hybrid
    vector_results: list[dict]       # 向量检索结果
    graph_results: list[dict]        # 图谱检索结果
    combined_context: str            # 合并后的上下文
    answer: str                      # 生成的答案
    citations: list[dict]            # 引用来源
    hallucination_score: float       # 幻觉分数
    hallucination_passed: bool       # 幻觉检查是否通过
    error: str | None                # 错误信息
```

#### 工作流图

**文件：** `agent-service/app/graph/agent_graph.py`

```
vision_preprocess → intent_recognition → retrieval_router
                                          │
                          ┌───────────────┼───────────────┐
                          ▼               ▼               ▼
                   vector_retrieval  graph_retrieval  (条件路由)
                          │               │
                          ├─(hybrid)──────┘
                          ▼
                   context_combiner → answer_generation → hallucination_check → END
```

**条件路由逻辑：**

| 路由节点 | 条件 | 目标 |
|----------|------|------|
| `retrieval_router` | strategy=graph | → graph_retrieval |
| `retrieval_router` | strategy=vector/hybrid | → vector_retrieval |
| `vector_retrieval` | strategy=hybrid | → graph_retrieval |
| `vector_retrieval` | strategy=vector | → context_combiner |

#### 工作流节点

| 节点 | 文件 | 输入 | 输出 | 说明 |
|------|------|------|------|------|
| **vision_preprocess** | `agent_graph.py` | image_url, query | query（增强后） | 截图分析：调用 VLM 解析截图内容，附加到 query 中 |
| **intent_recognition** | `nodes/intent_recognition.py` | query | intent, intent_confidence | 意图识别：调用 LLM 判断用户意图类别 |
| **retrieval_router** | `nodes/retrieval_router.py` | intent | retrieval_strategy | 检索路由：根据意图选择检索策略 |
| **vector_retrieval** | `nodes/vector_retrieval.py` | project_id, query | vector_results | 向量检索：从 Milvus 搜索相关文档片段 |
| **graph_retrieval** | `nodes/graph_retrieval.py` | project_id, query, intent | graph_results | 图谱检索：从 Neo4j 搜索相关实体关系 |
| **context_combiner** | `nodes/context_combiner.py` | vector_results, graph_results, strategy | combined_context | 上下文合并：格式化向量+图谱结果为统一上下文 |
| **answer_generation** | `nodes/answer_generation.py` | combined_context, query, intent | answer, citations | 答案生成：调用 LLM 基于上下文生成回答 |
| **hallucination_check** | `nodes/hallucination_check.py` | combined_context, answer | hallucination_score, hallucination_passed | 幻觉检查：验证回答是否基于上下文 |

**意图类别与检索策略映射：**

| 意图类别 | 检索策略 | 说明 |
|----------|----------|------|
| `operation_guide` | hybrid | 操作指引：同时检索文档和图谱 |
| `process_inquiry` | graph | 流程查询：仅检索知识图谱 |
| `concept_explanation` | vector | 概念解释：仅检索文档向量 |
| `troubleshooting` | hybrid | 问题排查：同时检索文档和图谱 |
| `general_query` | vector | 通用问答：仅检索文档向量 |

**容错机制：** 所有节点在 LLM API Key 未配置或调用失败时，返回合理的默认值而非抛出异常，确保工作流不会中断。

---

### Ingestion 摄取管线

**目录：** `agent-service/app/ingestion/`

文档摄取管线，将原始文档转化为可检索的向量嵌入和知识图谱实体。

#### pipeline.py — 摄取管线编排

**文件：** `agent-service/app/ingestion/pipeline.py`

完整摄取流程：

```
文件路径 → load_document → split_documents → ingest_to_milvus
                                              ↓
                                    extract_entities_from_documents
                                              ↓
                                    ingest_to_neo4j
```

`ingest_full_pipeline()` 返回：
```json
{
  "project_id": "uuid",
  "vector": { "collection_name": "bga_xxx", "total_documents": 1, "total_chunks": 15 },
  "graph": { "project_id": "uuid", "total_entities": 8, "total_relations": 12 }
}
```

#### document_loader.py — 文档加载

**文件：** `agent-service/app/ingestion/document_loader.py`

| 支持格式 | Loader |
|----------|--------|
| `.pdf` | PyPDFLoader |
| `.txt` | TextLoader |
| `.md` | TextLoader |

加载后为每个文档设置 `metadata.source` 为文件名。

#### text_splitter.py — 文本分块

**文件：** `agent-service/app/ingestion/text_splitter.py`

使用 `RecursiveCharacterTextSplitter`，分隔符优先级：`\n\n` → `\n` → `。` → `；` → `，` → 空格。默认 `chunk_size=500`，`chunk_overlap=50`。

#### vector_ingest.py — 向量摄取

**文件：** `agent-service/app/ingestion/vector_ingest.py`

流程：加载文档 → 分块 → 生成嵌入向量 → 写入 Milvus 集合。

集合命名规则：`bga_{project_id（横线替换为下划线）}`

#### entity_extractor.py — 实体抽取

**文件：** `agent-service/app/ingestion/entity_extractor.py`

调用 LLM 从文档分块中抽取业务实体和关系，输出格式：

```json
{
  "entities": [{"name": "实体名", "category": "类别", "description": "描述"}],
  "relations": [{"source": "源实体", "target": "目标实体", "type": "FLOW_TO|DEPENDS_ON|RELATES_TO", "description": "描述", "step_order": 1}]
}
```

#### graph_ingest.py — 图谱摄取

**文件：** `agent-service/app/ingestion/graph_ingest.py`

将抽取的实体和关系写入 Neo4j，使用 `MERGE` 语句确保幂等性。

#### ingest_worker.py — 摄取工作线程

**文件：** `agent-service/app/ingestion/ingest_worker.py`

在 production 模式下作为后台线程运行，轮询 Redis 队列 `ingest:queue:*`，处理待摄取的文档任务。

---

### Retrieval 检索客户端

**目录：** `agent-service/app/retrieval/`

#### milvus_client.py — Milvus 检索客户端

**文件：** `agent-service/app/retrieval/milvus_client.py`

`MilvusRetriever` 类：

| 方法 | 说明 |
|------|------|
| `search(query, top_k=5)` | 语义搜索：query → 嵌入向量 → Milvus 向量搜索 → 返回 top_k 结果 |
| `insert(documents)` | 批量插入：文本列表 → 嵌入向量 → 写入 Milvus |
| `_ensure_collection()` | 自动创建集合（若不存在），schema 含 id/vector/content/source/chunk_index |

**嵌入模型支持：**

- `openai`：使用 `OpenAIEmbeddings`（text-embedding-3-small）
- `local`：使用 `HuggingFaceEmbeddings`（all-MiniLM-L6-v2，维度 384，无需 API Key）

**集合 Schema：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT64 | 主键（自增） |
| vector | FLOAT_VECTOR | 嵌入向量（维度由 EMBEDDING_DIMENSION 决定） |
| content | VARCHAR(65535) | 文档内容 |
| source | VARCHAR(1024) | 来源文件名 |
| chunk_index | INT64 | 分块序号 |

**索引配置：** IVF_FLAT + COSINE 距离度量

#### neo4j_client.py — Neo4j 检索客户端

**文件：** `agent-service/app/retrieval/neo4j_client.py`

`Neo4jRetriever` 类：

| 方法 | 说明 |
|------|------|
| `search(query, intent)` | 知识图谱搜索，根据 intent 选择搜索策略 |
| `_search_process(session, query)` | 流程搜索：匹配 FLOW_TO/RELATES_TO/DEPENDS_ON 关系 |
| `_search_general(session, query)` | 通用搜索：匹配实体名称/描述 + 关联实体 |
| `ingest_entities(entities)` | 写入实体和关系到 Neo4j |
| `close()` | 关闭数据库连接 |

**Cypher 查询示例（流程搜索）：**

```cypher
MATCH (e1:Entity {project_id: $project_id})-[r:FLOW_TO|RELATES_TO|DEPENDS_ON]->(e2:Entity {project_id: $project_id})
WHERE e1.name CONTAINS $keyword OR e2.name CONTAINS $keyword
RETURN e1.name, type(r), e2.name, r.description, r.step_order
ORDER BY r.step_order
```

**关键词提取：** 自动去除中文停用词（的、了、是、怎么、如何 等），保留有效关键词。

---

### Prompt 模板与安全

**目录：** `agent-service/app/prompt/`

#### templates.py — Prompt 模板

**文件：** `agent-service/app/prompt/templates.py`

| 模板常量 | 用途 | 说明 |
|----------|------|------|
| `INTENT_RECOGNITION_SYSTEM` | 意图识别系统提示 | 定义 5 种意图类别和输出格式 |
| `INTENT_RECOGNITION_USER` | 意图识别用户提示 | 包含用户提问 |
| `ANSWER_GENERATION_SYSTEM` | 答案生成系统提示 | 按意图类别给出不同的回答要求 |
| `ANSWER_GENERATION_USER` | 答案生成用户提示 | 包含检索上下文和用户提问 |
| `HALLUCINATION_CHECK_SYSTEM` | 幻觉检查系统提示 | 定义审核标准和输出格式 |
| `HALLUCINATION_CHECK_USER` | 幻觉检查用户提示 | 包含上下文和生成的答案 |

**意图类别：** `operation_guide` / `process_inquiry` / `concept_explanation` / `troubleshooting` / `general_query`

#### injection_guard.py — 提示注入防护

**文件：** `agent-service/app/prompt/injection_guard.py`

| 函数 | 说明 |
|------|------|
| `check_injection(text)` | 检测提示注入攻击，返回 (is_injection, reason) |
| `sanitize_input(text)` | 清洗输入：去除 HTML 标签和控制字符 |

**检测模式：** ignore previous instructions、forget previous、you are now a、system:、`<system>` 标签、jailbreak、sudo、rm -rf、DROP TABLE、SQL 注入（`;--`）

---

## Frontend 前端

**目录：** `frontend/`  
**框架：** React + TypeScript + Vite

前端分为两个独立部分：
1. **ChatWidget** — 嵌入式对话组件，供最终用户使用
2. **Admin Panel** — 独立管理后台，供管理员管理项目和文档

---

### ChatWidget 对话组件

**文件：** `frontend/src/ChatWidget.tsx`

可嵌入到任意项目中的对话气泡组件。

**功能：**

- 浮动气泡按钮，点击展开/收起对话面板
- 消息列表展示（支持 Markdown 渲染）
- SSE 流式接收回答（逐字显示）
- 截图上传（多模态对话）
- 自动创建/复用会话

**配置接口（BGAWidgetConfig）：**

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| apiUrl | string | 是 | Backend API 地址 |
| projectId | string | 是 | 项目ID，决定知识库范围 |
| token | string | 否 | JWT Token |
| theme | "light" \| "dark" | 否 | 主题 |
| position | "bottom-right" \| "bottom-left" | 否 | 气泡位置 |
| title | string | 否 | 面板标题 |
| placeholder | string | 否 | 输入框占位文本 |

**使用方式：**

```tsx
import { ChatWidget } from "./src";

<ChatWidget config={{
  apiUrl: "http://localhost:3000",
  projectId: "your-project-uuid",
}} />
```

**URL 参数切换项目：** 通过 `?projectId=xxx` URL 参数可动态切换项目，实现同一组件服务不同项目的知识库。

---

### Admin 管理后台

**文件：** `frontend/admin.html`

独立的管理后台页面，用于项目和文档管理。

**功能：**

- 项目列表展示和创建
- 项目切换（点击项目后跳转到对话页面并带上 projectId）
- 文档上传和摄取状态查看
- 手动触发文档摄取
- 文档删除

**API 地址配置：** 通过 `window.__BGA_API_URL__` 全局变量注入，默认 `http://localhost:3000`。

**项目创建：** 使用内联输入框 + 按钮方式（避免浏览器阻止 `prompt()` 弹窗）。

---

### API Client

**文件：** `frontend/src/api.ts`

`ApiClient` 类封装了与 Backend 的所有 HTTP 交互。

| 方法 | 说明 |
|------|------|
| `createSession(projectId)` | 创建会话 |
| `sendMessage(sessionId, content, imageUrl?)` | 发送消息（非流式） |
| `streamMessage(sessionId, content, imageUrl?)` | 流式发送消息（SSE，返回 AsyncGenerator） |
| `uploadScreenshot(file)` | 上传截图 |

**响应包装：** Backend 所有响应格式为 `{ success: boolean, data: T, timestamp: string }`，`unwrap()` 方法自动解包。

---

### Types 类型定义

**文件：** `frontend/src/types.ts`

| 接口 | 说明 |
|------|------|
| `BGAWidgetConfig` | 组件配置 |
| `ChatMessage` | 聊天消息（id, role, content, timestamp, metadata） |
| `Citation` | 引用来源（type: document/graph, source, score） |
| `ChatResponse` | 对话响应（answer, intent, citations, hallucination 等） |

**导出入口：** `frontend/src/index.tsx` 导出 `ChatWidget` 组件和所有类型。

---

## 环境配置

**文件：** `.env`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `NODE_ENV` | development | 运行环境 |
| `BACKEND_PORT` | 3000 | Backend 端口 |
| `JWT_SECRET` | dev-jwt-secret | JWT 密钥 |
| `AGENT_SERVICE_URL` | http://localhost:8000 | Agent Service 地址 |
| `LLM_MODEL` | gpt-4o | LLM 模型 |
| `LLM_API_KEY` | — | LLM API Key |
| `LLM_BASE_URL` | https://api.openai.com/v1 | LLM API 地址 |
| `EMBEDDING_PROVIDER` | local | 嵌入提供商（openai/local） |
| `EMBEDDING_MODEL` | all-MiniLM-L6-v2 | 嵌入模型 |
| `EMBEDDING_DIMENSION` | 384 | 嵌入维度（local 模式 384，openai 模式 1536） |
| `MILVUS_HOST` | localhost | Milvus 地址 |
| `MILVUS_PORT` | 19530 | Milvus 端口 |
| `NEO4J_URI` | bolt://localhost:7687 | Neo4j 地址 |
| `NEO4J_PASSWORD` | — | Neo4j 密码 |
| `REDIS_HOST` | localhost | Redis 地址 |
| `REDIS_PORT` | 16379 | Redis 端口 |
| `POSTGRES_HOST` | localhost | PostgreSQL 地址 |
| `POSTGRES_PORT` | 15432 | PostgreSQL 端口 |
| `MINIO_ENDPOINT` | localhost:9000 | MinIO 地址 |

---

## 快速启动

### 1. 初始化项目

```bash
make init
# 或手动：
cp -n .env.example .env
cd backend && npm install
cd frontend && npm install
cd agent-service && pip install -r requirements.txt
```

### 2. 启动基础设施

```bash
docker compose up -d
```

### 3. 启动 Backend

```bash
cd backend && npm run start:dev
# 或
make dev-backend
```

### 4. 启动 Agent Service

```bash
cd agent-service && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# 或
make dev-agent
```

### 5. 启动 Frontend

```bash
cd frontend && npm run dev
# 或
make dev-frontend
```

### 6. 访问

- 对话界面：`http://localhost:5173/?projectId=your-project-id`
- 管理后台：`http://localhost:5173/admin.html`
- Backend API 文档：`http://localhost:3000/api/v1/docs`
- Agent Service API 文档：`http://localhost:8000/docs`

---

## API 接口总览

### Backend API（:3000/api/v1）

| 模块 | 方法 | 路径 | 说明 |
|------|------|------|------|
| Auth | POST | /auth/register | 用户注册 |
| Auth | POST | /auth/login | 用户登录 |
| Auth | GET | /auth/users | 用户列表 |
| Project | POST | /projects | 创建项目 |
| Project | GET | /projects | 项目列表 |
| Project | GET | /projects/:id | 项目详情 |
| Project | PUT | /projects/:id | 更新项目 |
| Project | DELETE | /projects/:id | 删除项目 |
| Document | POST | /documents/upload | 上传文档 |
| Document | POST | /documents/upload-screenshot | 上传截图 |
| Document | GET | /documents/project/:projectId | 项目文档列表 |
| Document | GET | /documents/:id | 文档详情 |
| Document | GET | /documents/:id/download | 文档下载 |
| Document | POST | /documents/:id/ingest | 触发摄取 |
| Document | DELETE | /documents/:id | 删除文档 |
| Chat | POST | /chat/sessions | 创建会话 |
| Chat | GET | /chat/sessions/project/:projectId | 项目会话列表 |
| Chat | GET | /chat/sessions/:sessionId/messages | 消息列表 |
| Chat | POST | /chat/messages | 发送消息 |
| Chat | POST | /chat/stream | 流式对话（SSE） |
| Knowledge | POST | /knowledge | 创建知识库 |
| Knowledge | GET | /knowledge/project/:projectId | 项目知识库列表 |
| Knowledge | GET | /knowledge/:id | 知识库详情 |
| Knowledge | GET | /knowledge/:id/graph-stats | 图谱统计 |
| Knowledge | GET | /knowledge/:id/vector-stats | 向量统计 |
| Knowledge | DELETE | /knowledge/:id | 删除知识库 |
| Health | GET | /health | 健康检查 |
| Health | GET | /health/ready | 就绪检查 |

### Agent Service API（:8000/api/v1）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /chat | 非流式对话 |
| POST | /chat/stream | 流式对话（SSE） |
| POST | /ingest/vector | 向量摄取 |
| POST | /ingest/full | 联合摄取 |
| POST | /ingest/pipeline | 完整管线摄取 |
| POST | /ingest/graph | 图谱摄取 |
| GET | /health | 健康检查 |