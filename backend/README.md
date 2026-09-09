# Backend — NestJS 服务层

基于 NestJS + TypeORM + PostgreSQL 的后端服务，提供 REST API 和 SSE 流式对话能力。

**端口：** 3000（默认）  
**全局前缀：** `/api/v1`  
**API 文档：** `http://localhost:3000/api/v1/docs`（Swagger）

---

## 启动入口

**文件：** `src/main.ts`

启动流程：
1. 创建 NestJS 应用
2. 设置全局路由前缀 `/api/v1`
3. 注册全局 ValidationPipe（白名单过滤 + 自动类型转换 + 自定义错误消息）
4. 注册全局异常过滤器 `AllExceptionsFilter`
5. 注册全局拦截器：`LoggingInterceptor`（请求日志）+ `TransformInterceptor`（统一响应包装 `{success, data, timestamp}`）
6. 启用 CORS
7. 配置 Swagger 文档
8. 监听 `BACKEND_PORT`

---

## 应用模块

**文件：** `src/app.module.ts`

根模块，导入并组织所有子模块：

```
AppModule
├── ConfigModule（全局，加载 .env）
├── TypeOrmModule（PostgreSQL 连接）
├── InfrastructureModule（全局，Milvus/Neo4j/Redis/MinIO）
├── AuthModule
├── ProjectModule
├── DocumentModule
├── ChatModule
├── KnowledgeModule
└── HealthModule
```

**TypeORM 配置：**
- 开发环境自动同步表结构（`synchronize: true`）
- 开发环境开启 SQL 日志（`logging: true`）

---

## Auth 模块

**目录：** `src/modules/auth/`

用户认证与授权，基于 JWT 实现。

### 文件清单

| 文件 | 职责 |
|------|------|
| `auth.controller.ts` | 认证路由：注册、登录、用户列表 |
| `auth.service.ts` | 业务逻辑：密码加密（bcrypt）、JWT 签发、用户查询 |
| `auth.module.ts` | 模块定义，导入 JwtModule |
| `user.entity.ts` | 用户实体定义 |
| `dto/auth.dto.ts` | RegisterDto / LoginDto |
| `guards/auth.guards.ts` | JwtAuthGuard，用于保护需要认证的接口 |
| `decorators/roles.decorator.ts` | Roles 装饰器，用于角色权限控制 |

### API 接口

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/v1/auth/register` | 否 | 用户注册，返回 `{user, token}` |
| POST | `/api/v1/auth/login` | 否 | 用户登录，返回 `{user, token}` |
| GET | `/api/v1/auth/users` | 是 | 获取所有用户 |

### User 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| username | string | UNIQUE | 用户名 |
| email | string | UNIQUE | 邮箱 |
| password | string | — | 密码（bcrypt 哈希） |
| role | enum | — | 角色：admin / user |
| createdAt | Date | — | 创建时间 |
| updatedAt | Date | — | 更新时间 |

---

## Project 模块

**目录：** `src/modules/project/`

项目隔离的核心模块。每个项目拥有独立的 Milvus Collection 和 Neo4j 标签，实现知识库数据隔离。

### 文件清单

| 文件 | 职责 |
|------|------|
| `project.controller.ts` | 项目 CRUD 路由 |
| `project.service.ts` | 项目业务逻辑，创建时自动生成 milvusCollectionName 和 neo4jLabel |
| `project.module.ts` | 模块定义 |
| `project.entity.ts` | 项目实体 |
| `dto/create-project.dto.ts` | 创建项目 DTO |
| `dto/update-project.dto.ts` | 更新项目 DTO |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/projects` | 创建项目 |
| GET | `/api/v1/projects` | 获取所有项目（按创建时间倒序） |
| GET | `/api/v1/projects/:id` | 获取单个项目 |
| PUT | `/api/v1/projects/:id` | 更新项目 |
| DELETE | `/api/v1/projects/:id` | 删除项目 |

### Project 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| name | string | UNIQUE | 项目名称 |
| description | string | 可空 | 项目描述 |
| isActive | boolean | 默认 true | 是否启用 |
| config | JSON | 可空 | 项目自定义配置 |
| milvusCollectionName | string | 可空 | Milvus 集合名（自动生成） |
| neo4jLabel | string | 可空 | Neo4j 标签名（自动生成） |
| createdAt | Date | — | 创建时间 |
| updatedAt | Date | — | 更新时间 |

### 关键逻辑

创建项目时自动生成隔离标识：
- `milvusCollectionName` = `bga_{name_lowercase_下划线替换空格}`
- `neo4jLabel` = `{NAME_UPPERCASE_下划线替换空格}`

例如：创建名为 "CRM System" 的项目 → `milvusCollectionName: "bga_crm_system"`, `neo4jLabel: "CRM_SYSTEM"`

---

## Document 模块

**目录：** `src/modules/document/`

文档上传、对象存储和摄取管理。

### 文件清单

| 文件 | 职责 |
|------|------|
| `document.controller.ts` | 文档管理路由：上传、下载、摄取触发、删除 |
| `document.service.ts` | 文档业务逻辑：MinIO 存储、摄取任务入队、状态回调 |
| `document.module.ts` | 模块定义 |
| `document.entity.ts` | 文档实体 |
| `dto/upload-document.dto.ts` | 上传 DTO |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/documents/upload` | 上传文档（multipart/form-data，字段：file + projectId） |
| POST | `/api/v1/documents/upload-screenshot` | 上传截图（用于多模态对话） |
| GET | `/api/v1/documents/project/:projectId` | 获取项目下所有文档（按时间倒序） |
| GET | `/api/v1/documents/:id` | 获取文档详情 |
| GET | `/api/v1/documents/:id/download` | 获取文档下载链接（MinIO 预签名 URL，302 重定向） |
| POST | `/api/v1/documents/:id/ingest` | 手动触发文档摄取 |
| DELETE | `/api/v1/documents/:id` | 删除文档 |

### Document 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| projectId | UUID | FK → Project | 所属项目 |
| originalName | string | — | 原始文件名 |
| storageKey | string | — | MinIO 存储路径 |
| mimeType | string | — | MIME 类型 |
| fileSize | number | — | 文件大小（字节） |
| chunkCount | number | 默认 0 | 分块数量 |
| ingestStatus | enum | 默认 pending | 摄取状态：pending / processing / completed / failed |
| ingestError | string | 可空 | 摄取错误信息 |
| createdAt | Date | — | 创建时间 |
| updatedAt | Date | — | 更新时间 |

### 摄取流程

```
用户上传文件
    │
    ▼
MinIO 存储（路径: projects/{projectId}/documents/{timestamp}_{filename}）
    │
    ▼
创建 Document 记录（ingestStatus: pending）
    │
    ▼
摄取任务入队 Redis（ingest:queue:{documentId}）
    │
    ▼
Agent Service IngestWorker 轮询 Redis
    │
    ▼
调用摄取管线（文档加载 → 分块 → 向量嵌入 → 实体抽取）
    │
    ▼
回调 Backend 更新摄取状态（completed / failed）
```

### 手动触发摄取

`triggerIngest(id)` 方法：
1. 检查文档状态，若正在处理中则拒绝
2. 更新状态为 processing
3. 获取 MinIO 预签名下载 URL
4. 调用 Agent Service `/api/v1/ingest/pipeline` 接口
5. 更新状态为 completed，记录 chunkCount
6. 失败时更新状态为 failed，记录错误信息

---

## Chat 模块

**目录：** `src/modules/chat/`

对话核心模块，管理会话和消息，支持 SSE 流式对话。

### 文件清单

| 文件 | 职责 |
|------|------|
| `chat.controller.ts` | 会话和消息路由，含 SSE 流式端点 |
| `chat.service.ts` | 对话业务逻辑：会话管理、消息持久化、Agent Service 调用、Redis 缓存 |
| `chat.module.ts` | 模块定义 |
| `chat-session.entity.ts` | 会话实体 |
| `chat-message.entity.ts` | 消息实体 |
| `dto/chat.dto.ts` | CreateSessionDto / SendMessageDto |
| `chat.service.spec.ts` | 单元测试 |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat/sessions` | 创建会话（需 projectId） |
| GET | `/api/v1/chat/sessions/project/:projectId` | 获取项目下所有会话（按时间倒序） |
| GET | `/api/v1/chat/sessions/:sessionId/messages` | 获取会话消息列表（按时间正序） |
| POST | `/api/v1/chat/messages` | 发送消息（非流式） |
| POST | `/api/v1/chat/stream` | 流式对话（SSE） |

### DTO 定义

**CreateSessionDto：**

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| projectId | string | @IsUUID, @IsNotEmpty | 项目ID |
| userId | string | @IsOptional, @IsString | 用户ID |
| title | string | @IsOptional, @IsString | 会话标题 |

**SendMessageDto：**

| 字段 | 类型 | 校验 | 说明 |
|------|------|------|------|
| sessionId | string | @IsUUID, @IsNotEmpty | 会话ID |
| content | string | @IsString, @IsNotEmpty | 消息内容 |
| imageUrl | string | @IsOptional, @IsString | 截图URL |

### ChatSession 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| projectId | UUID | FK → Project | 所属项目 |
| userId | string | 可空 | 用户ID |
| title | string | 可空 | 会话标题 |
| createdAt | Date | — | 创建时间 |
| updatedAt | Date | — | 更新时间 |

### ChatMessage 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| sessionId | UUID | FK → ChatSession | 所属会话 |
| role | enum | — | 角色：user / assistant |
| content | text | — | 消息内容 |
| metadata | JSON | 可空 | 元数据（intent, citations, hallucination 等） |
| createdAt | Date | — | 创建时间 |

### SSE 流式对话流程

```
POST /api/v1/chat/stream
    │
    ▼
设置 SSE 响应头（Content-Type: text/event-stream, Cache-Control: no-cache）
    │
    ▼
验证会话存在 → 不存在则发送 error 事件并结束
    │
    ▼
保存用户消息到数据库
    │
    ▼
发送 user_message SSE 事件
    │
    ▼
调用 ChatService.streamMessage()（内部转发到 Agent Service）
    │
    ▼
逐 chunk 转发 SSE 事件：data: {chunk}\n\n
    │
    ▼
发送 [DONE] 结束标记
```

### Redis 缓存机制

- 缓存键：`chat:cache:{projectId}:{query}`
- 非流式对话先查缓存，命中则直接返回
- 未命中则调用 Agent Service，结果写入缓存

### Agent Service 调用

- 地址：`AGENT_SERVICE_URL` 环境变量（默认 `http://localhost:8000`）
- 非流式：POST `/api/v1/chat`
- 流式：POST `/api/v1/chat/stream`，逐 chunk 读取 SSE 事件

---

## Knowledge 模块

**目录：** `src/modules/knowledge/`

知识库管理模块，提供向量库和知识图谱的统计查询。

### 文件清单

| 文件 | 职责 |
|------|------|
| `knowledge.controller.ts` | 知识库路由 |
| `knowledge.service.ts` | 知识库业务逻辑，含图谱和向量统计查询 |
| `knowledge.module.ts` | 模块定义 |
| `knowledge-base.entity.ts` | 知识库实体 |
| `dto/knowledge-base.dto.ts` | 创建知识库 DTO |

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/knowledge` | 创建知识库 |
| GET | `/api/v1/knowledge/project/:projectId` | 获取项目下知识库列表 |
| GET | `/api/v1/knowledge/:id` | 获取知识库详情 |
| GET | `/api/v1/knowledge/:id/graph-stats` | 获取知识图谱统计 |
| GET | `/api/v1/knowledge/:id/vector-stats` | 获取向量库统计 |
| DELETE | `/api/v1/knowledge/:id` | 删除知识库 |

### KnowledgeBase 实体

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | UUID | PK | 主键 |
| projectId | UUID | FK → Project | 所属项目 |
| name | string | — | 知识库名称 |
| description | string | 可空 | 描述 |
| type | enum | 默认 vector | 类型：vector / graph / hybrid |
| documentCount | number | 默认 0 | 文档数量 |
| entityCount | number | 默认 0 | 实体数量 |
| isActive | boolean | 默认 true | 是否启用 |
| createdAt | Date | — | 创建时间 |
| updatedAt | Date | — | 更新时间 |

### 统计查询实现

**图谱统计（getGraphStats）：**

```cypher
MATCH (e:Entity {project_id: $projectId})
RETURN labels(e) AS labels, count(e) AS count
ORDER BY count DESC
```

返回各标签的实体数量分布。

**向量统计（getVectorStats）：**

1. 检查 Milvus 是否可用
2. 检查集合是否存在（`hasCollection`）
3. 获取集合行数（`getCollectionStatistics`）

返回：`{collectionName, exists, entityCount, available}`

---

## Health 模块

**目录：** `src/modules/health/`

系统健康检查，用于 K8s/Docker 健康探测。

### API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 健康检查，返回 `{status: "ok", timestamp, service, version}` |
| GET | `/api/v1/health/ready` | 就绪检查，返回 `{status: "ready", timestamp}` |

---

## Infrastructure 模块

**目录：** `src/infrastructure/`

全局基础设施模块，封装外部服务客户端。

### 子模块

| 子模块 | 目录 | 提供服务 | 注入方式 |
|--------|------|----------|----------|
| **MilvusModule** | `milvus/` | MilvusService：向量数据库连接、集合管理、搜索 | `@Inject(MILVUS_SERVICE)` |
| **Neo4jModule** | `neo4j/` | Neo4jService：Cypher 查询执行 | `@Inject(NEO4J_SERVICE)` |
| **RedisModule** | `redis/` | RedisService：缓存 get/set/del、过期管理 | `@Inject(REDIS_SERVICE)` |
| **MinioModule** | `minio/` | MinioService：对象上传/下载、预签名 URL 生成 | `@Inject(MINIO_SERVICE)` |

该模块标记为 `@Global()`，所有业务模块可直接注入使用。

### 公共组件

| 文件 | 职责 |
|------|------|
| `common/filters/all-exceptions.filter.ts` | 全局异常过滤器，统一错误响应格式 |
| `common/interceptors/logging.interceptor.ts` | 请求日志拦截器，记录请求方法和 URL |
| `common/interceptors/transform.interceptor.ts` | 响应包装拦截器，将返回值包装为 `{success: true, data, timestamp}` |