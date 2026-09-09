# 项目获取与配置指南

本文档面向**新拿到项目的人**，从零开始说明需要做什么、配置什么，才能把系统完整跑起来。

---

## 目录

- [前置条件](#前置条件)
- [第一步：获取项目代码](#第一步获取项目代码)
- [第二步：安装依赖](#第二步安装依赖)
- [第三步：配置环境变量](#第三步配置环境变量)
- [第四步：启动基础设施](#第四步启动基础设施)
- [第五步：启动应用服务](#第五步启动应用服务)
- [第六步：初始化业务数据](#第六步初始化业务数据)
- [第七步：验证系统](#第七步验证系统)
- [一键启动（Docker 全容器模式）](#一键启动docker-全容器模式)
- [配置项详解](#配置项详解)
- [常见问题](#常见问题)
- [生产环境部署](#生产环境部署)

---

## 前置条件

拿到项目前，你的机器上需要安装以下软件：

| 软件 | 最低版本 | 用途 | 检查命令 |
|------|----------|------|----------|
| **Node.js** | 18.x | Backend + Frontend 运行时 | `node -v` |
| **npm** | 9.x | Node 包管理 | `npm -v` |
| **Python** | 3.11 | Agent Service 运行时 | `python3 --version` |
| **pip** | 23.x | Python 包管理 | `pip --version` |
| **Docker** | 24.x | 基础设施容器 | `docker --version` |
| **Docker Compose** | 2.x | 容器编排 | `docker compose version` |
| **Git** | 2.x | 代码获取 | `git --version` |

> **提示：** macOS 用户推荐使用 [Homebrew](https://brew.sh/) 安装：`brew install node python docker git`

---

## 第一步：获取项目代码

```bash
git clone <你的仓库地址> business-guide-agent
cd business-guide-agent
```

项目目录结构：

```
business-guide-agent/
├── .env.example          ← 环境变量模板（重要！）
├── .env                  ← 实际环境变量（需自己创建，已被 .gitignore 忽略）
├── docker-compose.yml    ← 基础设施容器编排
├── Makefile              ← 常用命令快捷方式
├── backend/              ← NestJS 后端
├── agent-service/        ← Python Agent 服务
└── frontend/             ← React 前端
```

---

## 第二步：安装依赖

### 方式一：使用 Makefile（推荐）

```bash
make init
```

这会自动完成：
- 复制 `.env.example` 为 `.env`（如已存在则跳过）
- 安装 Backend 依赖（`npm install`）
- 安装 Frontend 依赖（`npm install`）
- 安装 Agent Service 依赖（`pip install -r requirements.txt`）

### 方式二：手动安装

```bash
# 1. 复制环境变量模板
cp .env.example .env

# 2. Backend 依赖
cd backend
npm install
cd ..

# 3. Frontend 依赖
cd frontend
npm install
cd ..

# 4. Agent Service 依赖
cd agent-service
pip install -r requirements.txt
# 或使用虚拟环境（推荐）：
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cd ..
```

> **⚠️ 重要：** Agent Service 使用了 `sentence-transformers`（本地嵌入模型），首次运行时会自动下载模型文件（约 90MB），请确保网络通畅。

---

## 第三步：配置环境变量

**这是最关键的一步！** 项目几乎所有行为都由 `.env` 文件控制。

### 3.1 创建 .env 文件

```bash
cp .env.example .env
```

### 3.2 必须修改的配置

打开 `.env` 文件，**以下配置必须修改**，否则系统无法正常运行：

```bash
# ═══════════════════════════════════════════════════════════
# 🔴 必须修改 — 不改就不能用
# ═══════════════════════════════════════════════════════════

# LLM API Key — 智能对话的核心，没有它 Agent 无法工作
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# 获取方式：
#   - OpenAI 官方：https://platform.openai.com/api-keys
#   - 兼容 API（如 guaihub.com）：注册后获取 API Key

# LLM API 地址 — 如果用 OpenAI 官方保持默认，如果用兼容 API 需要改
LLM_BASE_URL=https://api.openai.com/v1
# 示例（使用兼容 API）：
# LLM_BASE_URL=https://guaihub.com/v1

# LLM 模型名 — 需要你的 API 提供商支持该模型
LLM_MODEL=gpt-4o
# 示例（使用兼容 API 的模型）：
# LLM_MODEL=video-ds-2.0

# JWT 密钥 — 生产环境必须改为随机强密码
JWT_SECRET=your-jwt-secret-change-me
# 生成方式：openssl rand -hex 32

# Neo4j 密码 — 图数据库密码
NEO4J_PASSWORD=your-neo4j-password-change-me
# 生成方式：openssl rand -hex 16

# PostgreSQL 密码 — 主数据库密码
POSTGRES_PASSWORD=your-postgres-password-change-me
# 生成方式：openssl rand -hex 16
```

### 3.3 嵌入模型配置（二选一）

嵌入模型用于将文本转化为向量，有 **两种方式** 可选：

#### 方式 A：本地嵌入（推荐，免费，无需 API Key）

```bash
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
# EMBEDDING_API_KEY 和 EMBEDDING_BASE_URL 不需要设置
```

- ✅ 免费，无需任何 API Key
- ✅ 离线可用
- ⚠️ 首次运行自动下载模型文件（约 90MB）
- ⚠️ 向量维度 384（比 OpenAI 的 1536 小，精度略低）

#### 方式 B：OpenAI 嵌入（精度更高，需付费）

```bash
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EMBEDDING_BASE_URL=https://api.openai.com/v1
EMBEDDING_DIMENSION=1536
```

- ✅ 精度更高（1536 维）
- ⚠️ 需要 OpenAI API Key
- ⚠️ 每次嵌入调用产生费用

### 3.4 可选修改的配置

```bash
# ═══════════════════════════════════════════════════════════
# 🟡 可选修改 — 有默认值，按需调整
# ═══════════════════════════════════════════════════════════

# 运行环境
NODE_ENV=development              # production 时 Agent Service 启动后台摄取线程

# Backend 端口
BACKEND_PORT=3000                 # 默认 3000，如端口冲突可修改

# Agent Service 端口
AGENT_SERVICE_PORT=8000           # 默认 8000

# Agent Service 地址（Backend 调用 Agent 用）
AGENT_SERVICE_URL=http://localhost:8000   # 本地开发用 localhost
                                   # Docker 全容器模式用 http://agent-service:8000

# LLM 生成温度（0=确定性强，1=创造性强）
LLM_TEMPERATURE=0.1               # 业务场景建议 0.1-0.3

# Milvus 集合名前缀
MILVUS_COLLECTION_PREFIX=bga_     # 一般不需要改

# MinIO 对象存储
MINIO_ENDPOINT=localhost:9000     # 本地开发
MINIO_ACCESS_KEY=minioadmin       # 生产环境必须改
MINIO_SECRET_KEY=minioadmin       # 生产环境必须改
```

### 3.5 本地开发 vs Docker 容器模式的区别

| 配置项 | 本地开发 | Docker 全容器模式 |
|--------|----------|-------------------|
| `AGENT_SERVICE_URL` | `http://localhost:8000` | `http://agent-service:8000` |
| `MILVUS_HOST` | `localhost` | `milvus-standalone` |
| `NEO4J_URI` | `bolt://localhost:7687` | `bolt://neo4j:7687` |
| `REDIS_HOST` | `localhost` | `redis` |
| `POSTGRES_HOST` | `localhost` | `postgres` |
| `MINIO_ENDPOINT` | `localhost:9000` | `minio:9000` |

> **⚠️ 关键：** 如果你用本地开发模式（手动启动 Backend 和 Agent），必须用 `localhost`；如果用 Docker 全容器模式，必须用容器名。

---

## 第四步：启动基础设施

基础设施包括 PostgreSQL、Redis、Milvus、Neo4j、MinIO，全部通过 Docker Compose 启动。

```bash
# 启动所有基础设施容器
docker compose up -d

# 查看容器状态（等待所有容器 healthy）
docker compose ps

# 查看日志（排查启动问题）
docker compose logs -f
```

### 等待容器就绪

启动后需要等待所有容器变为 `healthy` 状态，通常需要 **1-3 分钟**（Milvus 启动较慢）：

```bash
# 持续检查状态，直到所有容器都是 healthy
docker compose ps
```

预期输出：

```
NAME              STATUS
bga-postgres      Up (healthy)
bga-redis         Up (healthy)
bga-milvus        Up (healthy)
bga-neo4j         Up (healthy)
bga-minio         Up (healthy)
bga-milvus-etcd   Up
bga-milvus-minio  Up
```

### 基础设施端口一览

| 服务 | 本机端口 | 用途 |
|------|----------|------|
| PostgreSQL | 15432 | 主数据库 |
| Redis | 16379 | 缓存 + 任务队列 |
| Milvus | 19530 | 向量数据库 |
| Neo4j Browser | 7474 | 图数据库管理界面 |
| Neo4j Bolt | 7687 | 图数据库连接 |
| MinIO API | 9000 | 对象存储 API |
| MinIO Console | 9001 | 对象存储管理界面（http://localhost:9001） |

### 初始化 MinIO Bucket

首次启动需要创建 MinIO Bucket（用于存储上传的文档）：

1. 打开 MinIO Console：http://localhost:9001
2. 登录（用户名/密码：`minioadmin` / `minioadmin`）
3. 点击 **Create Bucket**，输入名称 `business-guide-agent`
4. 点击 **Create Bucket** 确认

> **提示：** 如果 MinIO Console 无法访问，检查容器是否 healthy：`docker compose ps bga-minio`

---

## 第五步：启动应用服务

### 方式一：本地开发模式（推荐开发时使用）

打开 **3 个终端**，分别启动 Backend、Agent Service、Frontend：

**终端 1 — Backend：**
```bash
cd backend
npm run start:dev
# 或使用 Makefile：make dev-backend
```
启动成功后显示：`Nest application successfully started on http://localhost:3000`

**终端 2 — Agent Service：**
```bash
cd agent-service
# 如果使用虚拟环境：
source .venv/bin/activate

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
# 或使用 Makefile：make dev-agent
```
启动成功后显示：`Uvicorn running on http://0.0.0.0:8000`

**终端 3 — Frontend：**
```bash
cd frontend
npm run dev
# 或使用 Makefile：make dev-frontend
```
启动成功后显示：`Local: http://localhost:5173/`

### 方式二：Docker 容器模式

```bash
# 构建并启动所有服务（含应用）
docker compose up -d --build

# 查看状态
docker compose ps

# 查看日志
docker compose logs -f backend agent-service frontend
```

> **注意：** Docker 全容器模式下，`.env` 中的服务地址需要改为容器名（见 3.5 节）。

---

## 第六步：初始化业务数据

### 6.1 创建项目

系统需要至少一个项目才能使用对话功能。

**方式 A：通过管理后台**

1. 打开管理后台：http://localhost:5173/admin.html
2. 在"新建项目"输入框中输入项目名称（如"CRM系统"）
3. 点击 **+ 新建项目**

**方式 B：通过 API**

```bash
curl -X POST http://localhost:3000/api/v1/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "CRM系统", "description": "CRM业务指引助手"}'
```

返回结果中包含项目 ID（UUID），**请记录下来**，后续配置需要用到。

### 6.2 上传文档

**方式 A：通过管理后台**

1. 在管理后台选择刚创建的项目
2. 点击 **选择文件** 上传业务文档（支持 PDF、TXT、MD）
3. 上传后文档状态为"待处理"
4. 点击 **摄取** 按钮触发文档摄取
5. 等待状态变为"已完成"

**方式 B：通过 API**

```bash
# 上传文档
curl -X POST http://localhost:3000/api/v1/documents/upload \
  -F "file=@/path/to/your/document.pdf" \
  -F "projectId=你的项目ID"

# 触发摄取（用返回的文档ID）
curl -X POST http://localhost:3000/api/v1/documents/{文档ID}/ingest
```

### 6.3 验证摄取结果

```bash
# 查看向量库统计
curl http://localhost:3000/api/v1/knowledge/{知识库ID}/vector-stats

# 查看图谱统计
curl http://localhost:3000/api/v1/knowledge/{知识库ID}/graph-stats
```

---

## 第七步：验证系统

### 7.1 健康检查

```bash
# Backend 健康检查
curl http://localhost:3000/api/v1/health
# 预期返回：{"success":true,"data":{"status":"ok",...}}

# Agent Service 健康检查
curl http://localhost:8000/health
# 预期返回：{"status":"ok",...} 或 {"status":"degraded",...}
```

### 7.2 测试对话

1. 打开对话界面：http://localhost:5173/?projectId=你的项目ID
2. 点击右下角对话气泡
3. 输入问题（如"客户建档流程是什么"）
4. 确认收到回答

### 7.3 查看 API 文档

- Backend Swagger：http://localhost:3000/api/v1/docs
- Agent Service Swagger：http://localhost:8000/docs

---

## 一键启动（Docker 全容器模式）

如果你不想本地安装 Node.js 和 Python，可以用 Docker 一键启动所有服务：

### 1. 配置环境变量

```bash
cp .env.example .env
```

修改 `.env` 中的关键配置：

```bash
# 必须修改
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_BASE_URL=https://api.openai.com/v1   # 或兼容 API 地址
LLM_MODEL=gpt-4o                          # 或兼容 API 支持的模型
JWT_SECRET=$(openssl rand -hex 32)        # 生成随机密钥
NEO4J_PASSWORD=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$(openssl rand -hex 16)

# Docker 模式必须用容器名
AGENT_SERVICE_URL=http://agent-service:8000
MILVUS_HOST=milvus-standalone
NEO4J_URI=bolt://neo4j:7687
REDIS_HOST=redis
POSTGRES_HOST=postgres
MINIO_ENDPOINT=minio:9000

# 嵌入模型（推荐本地模式，免费）
EMBEDDING_PROVIDER=local
EMBEDDING_MODEL=all-MiniLM-L6-v2
EMBEDDING_DIMENSION=384
```

### 2. 构建并启动

```bash
docker compose up -d --build
```

### 3. 等待就绪

```bash
# 查看状态（等待所有容器 healthy）
docker compose ps

# 查看 Backend 日志
docker compose logs -f backend

# 查看 Agent Service 日志
docker compose logs -f agent-service
```

### 4. 初始化 MinIO Bucket

同[第四步](#初始化-minio-bucket)。

### 5. 创建项目并上传文档

同[第六步](#第六步初始化业务数据)。

### 6. 访问

| 服务 | 地址 |
|------|------|
| 对话界面 | http://localhost:8888/?projectId=你的项目ID |
| 管理后台 | http://localhost:8888/admin.html |
| Backend API | http://localhost:3000/api/v1 |
| Agent Service API | http://localhost:8000/api/v1 |

---

## 配置项详解

### 完整 .env 配置清单

```bash
# ═══════════════════════════════════════════════════════════
# 通用
# ═══════════════════════════════════════════════════════════
NODE_ENV=development                    # development | production
LOG_LEVEL=debug                         # debug | info | warn | error

# ═══════════════════════════════════════════════════════════
# Backend（NestJS）
# ═══════════════════════════════════════════════════════════
BACKEND_PORT=3000                       # Backend 监听端口
JWT_SECRET=your-jwt-secret             # JWT 签名密钥（生产环境必须改）
JWT_EXPIRES_IN=7d                      # JWT 过期时间

# ═══════════════════════════════════════════════════════════
# Agent Service（FastAPI）
# ═══════════════════════════════════════════════════════════
AGENT_SERVICE_PORT=8000                # Agent 监听端口
AGENT_SERVICE_HOST=0.0.0.0            # Agent 监听地址
AGENT_SERVICE_URL=http://localhost:8000  # Backend 调用 Agent 的地址

# ═══════════════════════════════════════════════════════════
# LLM（大语言模型）
# ═══════════════════════════════════════════════════════════
LLM_PROVIDER=openai                    # 目前仅支持 openai（兼容接口）
LLM_MODEL=gpt-4o                       # 模型名
LLM_API_KEY=sk-xxx                     # 🔴 API Key（必须填写）
LLM_BASE_URL=https://api.openai.com/v1 # API 地址
LLM_TEMPERATURE=0.1                    # 生成温度（0-1）

# ═══════════════════════════════════════════════════════════
# 嵌入模型
# ═══════════════════════════════════════════════════════════
EMBEDDING_PROVIDER=local               # openai | local
EMBEDDING_MODEL=all-MiniLM-L6-v2      # local: all-MiniLM-L6-v2 | openai: text-embedding-3-small
EMBEDDING_API_KEY=                     # openai 模式需要
EMBEDDING_BASE_URL=                    # openai 模式需要
EMBEDDING_DIMENSION=384                # local: 384 | openai: 1536

# ═══════════════════════════════════════════════════════════
# Milvus（向量数据库）
# ═══════════════════════════════════════════════════════════
MILVUS_HOST=localhost                  # Milvus 地址
MILVUS_PORT=19530                      # Milvus 端口
MILVUS_COLLECTION_PREFIX=bga_          # 集合名前缀

# ═══════════════════════════════════════════════════════════
# Neo4j（知识图谱）
# ═══════════════════════════════════════════════════════════
NEO4J_URI=bolt://localhost:7687        # 连接地址
NEO4J_USER=neo4j                       # 用户名
NEO4J_PASSWORD=neo4jpassword           # 🔴 密码（必须修改）
NEO4J_DATABASE=neo4j                   # 数据库名

# ═══════════════════════════════════════════════════════════
# Redis（缓存 + 队列）
# ═══════════════════════════════════════════════════════════
REDIS_HOST=localhost                   # Redis 地址
REDIS_PORT=16379                       # Redis 端口
REDIS_PASSWORD=                        # Redis 密码（默认无）

# ═══════════════════════════════════════════════════════════
# MinIO（对象存储）
# ═══════════════════════════════════════════════════════════
MINIO_ENDPOINT=localhost:9000          # MinIO 地址
MINIO_ACCESS_KEY=minioadmin            # Access Key
MINIO_SECRET_KEY=minioadmin            # Secret Key（生产环境必须改）
MINIO_BUCKET=business-guide-agent      # Bucket 名称
MINIO_USE_SSL=false                    # 是否使用 SSL

# ═══════════════════════════════════════════════════════════
# PostgreSQL（主数据库）
# ═══════════════════════════════════════════════════════════
POSTGRES_HOST=localhost                # PostgreSQL 地址
POSTGRES_PORT=15432                    # PostgreSQL 端口
POSTGRES_USER=postgres                 # 用户名
POSTGRES_PASSWORD=postgres             # 🔴 密码（必须修改）
POSTGRES_DB=business_guide_agent       # 数据库名

# ═══════════════════════════════════════════════════════════
# Frontend（Vite 开发服务器）
# ═══════════════════════════════════════════════════════════
VITE_API_URL=http://localhost:3000     # Backend API 地址
VITE_PROJECT_ID=demo-project           # 默认项目ID
```

---

## 常见问题

### Q1：`docker compose up -d` 后 Milvus 容器一直不 healthy

**原因：** Milvus 启动较慢，需要等待 2-3 分钟。

**解决：**
```bash
# 查看 Milvus 日志
docker compose logs -f milvus-standalone

# 如果持续不 healthy，尝试重启
docker compose restart milvus-standalone
```

### Q2：前端发送消息提示"请求失败"

**排查步骤：**

1. 检查 Backend 是否启动：`curl http://localhost:3000/api/v1/health`
2. 检查 Agent Service 是否启动：`curl http://localhost:8000/health`
3. 检查 `.env` 中 `AGENT_SERVICE_URL` 是否正确（本地开发应为 `http://localhost:8000`）
4. 检查 `LLM_API_KEY` 是否有效
5. 检查浏览器控制台的网络请求，确认请求地址和响应

### Q3：文档摄取一直失败

**排查步骤：**

1. 检查 Milvus 是否 healthy：`docker compose ps bga-milvus`
2. 检查 Neo4j 是否 healthy：`docker compose ps bga-neo4j`
3. 检查 MinIO Bucket 是否创建：访问 http://localhost:9001
4. 查看 Agent Service 日志：`docker compose logs -f agent-service` 或终端输出
5. 确认文档格式为 PDF/TXT/MD

### Q4：Agent Service 启动报错 `LLM API Key 未配置`

**原因：** `.env` 中 `LLM_API_KEY` 为空或为默认占位符。

**解决：** 在 `.env` 中设置有效的 API Key：
```bash
LLM_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Q5：嵌入模型下载失败 / 速度慢

**原因：** `sentence-transformers` 首次运行需从 HuggingFace 下载模型。

**解决：**
- 确保网络可访问 huggingface.co
- 如网络受限，可改用 OpenAI 嵌入（设置 `EMBEDDING_PROVIDER=openai`）
- 或设置 HuggingFace 镜像：`export HF_ENDPOINT=https://hf-mirror.com`

### Q6：端口冲突

**原因：** 默认端口被其他服务占用。

**解决：** 修改 `.env` 中的端口配置：

| 冲突端口 | 修改配置 | 示例 |
|----------|----------|------|
| 3000 | `BACKEND_PORT=3001` | |
| 8000 | `AGENT_SERVICE_PORT=8001` | 同时修改 `AGENT_SERVICE_URL` |
| 5173 | Vite 自动寻找下一个可用端口 | |
| 15432 | 修改 `docker-compose.yml` 中 postgres 的端口映射 | |
| 16379 | 修改 `docker-compose.yml` 中 redis 的端口映射 | |

### Q7：Docker 全容器模式下 Backend 连不上 Agent Service

**原因：** `.env` 中 `AGENT_SERVICE_URL` 使用了 `localhost` 而非容器名。

**解决：**
```bash
# Docker 模式必须用容器名
AGENT_SERVICE_URL=http://agent-service:8000
```

### Q8：创建项目后对话没有知识库内容

**原因：** 项目创建后需要上传文档并完成摄取。

**解决：**
1. 在管理后台上传文档
2. 触发摄取并等待状态变为"已完成"
3. 重新提问

---

## 生产环境部署

### 安全配置清单

```bash
# 1. 生成强密钥
JWT_SECRET=$(openssl rand -hex 32)
NEO4J_PASSWORD=$(openssl rand -hex 16)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
MINIO_ACCESS_KEY=$(openssl rand -hex 12)
MINIO_SECRET_KEY=$(openssl rand -hex 24)

# 2. 设置生产环境
NODE_ENV=production

# 3. 关闭调试日志
LOG_LEVEL=warn

# 4. 关闭 TypeORM 同步（使用迁移）
# 在 backend/src/app.module.ts 中设置 synchronize: false
```

### 性能调优

```bash
# Neo4j 内存（根据服务器配置调整）
# 在 docker-compose.yml 中修改：
NEO4J_server_memory_pagecache_size: 512M
NEO4J_server_memory_heap_max__size: 1G

# Milvus 索引参数
# 在 agent-service/app/retrieval/milvus_client.py 中调整 nlist

# LLM 温度（业务场景建议低温度）
LLM_TEMPERATURE=0.1
```

### 反向代理配置（Nginx 示例）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        proxy_pass http://localhost:8888;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Agent Service（不直接对外暴露，仅 Backend 内部调用）
    # 如果需要直接访问 Agent API：
    location /agent-api/ {
        proxy_pass http://localhost:8000/api/;
    }
}
```

### 数据备份

```bash
# PostgreSQL 备份
docker exec bga-postgres pg_dump -U postgres business_guide_agent > backup_$(date +%Y%m%d).sql

# Neo4j 备份
docker exec bga-neo4j neo4j-admin database dump neo4j --to-path=/backup/

# MinIO 备份
mc mirror local/business-guide-agent /backup/minio/
```