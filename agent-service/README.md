# Agent Service — FastAPI + LangGraph 智能对话引擎

基于 FastAPI + LangGraph + LangChain 的智能对话引擎，实现意图识别、混合检索（向量+图谱）、答案生成和幻觉检查的完整工作流。

**端口：** 8000（默认）  
**API 前缀：** `/api/v1`  
**API 文档：** `http://localhost:8000/docs`（Swagger UI）

---

## 启动入口

**文件：** `app/main.py`

启动流程：
1. 创建 FastAPI 应用
2. 配置 CORS（允许所有来源、方法、头）
3. 注册 API 路由（`/api/v1` 前缀）
4. 在 production 模式下启动 IngestWorker 后台线程（轮询 Redis 摄取队列）
5. 注册 `/health` 健康检查端点

**健康检查逻辑：** 依次检测 Milvus、Neo4j、Redis 连通性，全部通过返回 `ok`，否则返回 `degraded`。

---

## Config 配置

**文件：** `app/config/settings.py`

基于 `pydantic-settings` 的配置管理，自动从 `.env` 文件和环境变量加载。

### 配置项

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `NODE_ENV` | development | 运行环境（production 时启动 IngestWorker） |
| `LOG_LEVEL` | info | 日志级别 |
| `AGENT_SERVICE_HOST` | 0.0.0.0 | 监听地址 |
| `AGENT_SERVICE_PORT` | 8000 | 监听端口 |
| `LLM_PROVIDER` | openai | LLM 提供商 |
| `LLM_MODEL` | gpt-4o | LLM 模型名 |
| `LLM_API_KEY` | "" | LLM API Key（未配置时节点返回默认值） |
| `LLM_BASE_URL` | https://api.openai.com/v1 | LLM API 地址（可替换为兼容 API） |
| `LLM_TEMPERATURE` | 0.1 | 生成温度 |
| `EMBEDDING_PROVIDER` | openai | 嵌入模型提供商（openai / local） |
| `EMBEDDING_MODEL` | text-embedding-3-small | 嵌入模型名 |
| `EMBEDDING_API_KEY` | "" | 嵌入 API Key |
| `EMBEDDING_BASE_URL` | https://api.openai.com/v1 | 嵌入 API 地址 |
| `EMBEDDING_DIMENSION` | 1536 | 嵌入向量维度 |
| `MILVUS_HOST` | localhost | Milvus 地址 |
| `MILVUS_PORT` | 19530 | Milvus 端口 |
| `MILVUS_COLLECTION_PREFIX` | bga_ | Milvus 集合名前缀 |
| `NEO4J_URI` | bolt://localhost:7687 | Neo4j 连接地址 |
| `NEO4J_USER` | neo4j | Neo4j 用户名 |
| `NEO4J_PASSWORD` | "" | Neo4j 密码 |
| `NEO4J_DATABASE` | neo4j | Neo4j 数据库名 |
| `REDIS_HOST` | localhost | Redis 地址 |
| `REDIS_PORT` | 6379 | Redis 端口 |
| `REDIS_PASSWORD` | "" | Redis 密码 |
| `MINIO_ENDPOINT` | localhost:9000 | MinIO 地址 |
| `MINIO_ACCESS_KEY` | minioadmin | MinIO Access Key |
| `MINIO_SECRET_KEY` | minioadmin | MinIO Secret Key |
| `MINIO_BUCKET` | business-guide-agent | MinIO Bucket |
| `MINIO_USE_SSL` | false | MinIO 是否使用 SSL |

---

## API 路由层

**文件：** `app/api/routes.py`

### 接口列表

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/chat` | 非流式对话，执行完整 LangGraph 工作流后返回 |
| POST | `/api/v1/chat/stream` | 流式对话（SSE），逐步推送工作流事件 |
| POST | `/api/v1/ingest/vector` | 仅向量摄取 |
| POST | `/api/v1/ingest/full` | 联合摄取（向量 + 知识图谱） |
| POST | `/api/v1/ingest/pipeline` | 完整摄取管线（支持文件 URL 下载） |
| POST | `/api/v1/ingest/graph` | 仅图谱摄取 |

### 请求模型

**ChatRequest / StreamRequest：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | str | 是 | 项目ID，用于数据隔离 |
| query | str | 是 | 用户提问（min_length=1） |
| image_url | str | 否 | 系统截图 URL |

**IngestRequest：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | str | 是 | 项目ID |
| file_path | str | 是 | 本地文件路径 |
| chunk_size | int | 否 | 分块大小（默认 500） |
| chunk_overlap | int | 否 | 分块重叠（默认 50） |
| extract_graph | bool | 否 | 是否抽取图谱（默认 true） |

**PipelineIngestRequest：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | str | 是 | 项目ID |
| file_url | str | 是 | 文件下载 URL（MinIO 预签名地址） |
| document_id | str | 否 | 文档ID（用于回调 Backend 更新状态） |
| chunk_size | int | 否 | 分块大小（默认 500） |
| chunk_overlap | int | 否 | 分块重叠（默认 50） |
| extract_graph | bool | 否 | 是否抽取图谱（默认 true） |

**GraphIngestRequest：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_id | str | 是 | 项目ID |
| entities | list[dict] | 是 | 实体列表 |

### 响应模型

**ChatResponse：**

| 字段 | 类型 | 说明 |
|------|------|------|
| answer | str | 生成的答案 |
| intent | str | 识别的意图 |
| intent_confidence | float | 意图置信度 |
| retrieval_strategy | str | 使用的检索策略 |
| citations | list[dict] | 引用来源列表 |
| hallucination_score | float | 幻觉分数（0-1，越高越可能幻觉） |
| hallucination_passed | bool | 幻觉检查是否通过 |

### 安全检查

所有 chat 请求在执行工作流前先经过 `check_injection()` 检测提示注入攻击，检测到则返回 HTTP 400。

### SSE 流式事件

`/api/v1/chat/stream` 返回的 SSE 事件类型：

| 事件 data | 说明 |
|-----------|------|
| `{"type": "answer", "content": "..."}` | 答B案生成完成事件 |
| `{"type": "intent", "data": {...}}` | 意图识别完成事件 |
| `{"type": "hallucination", "data": {...}}` | 幻觉检查完成事件 |
| `[DONE]` | 流结束标记 |

### 初始状态构建

`_build_initial_state()` 函数将请求转换为 LangGraph 初始状态，同时对 query 执行 `sanitize_input()` 清洗（去除 HTML 标签和控制字符）。

---

## Graph 工作流

**目录：** `app/graph/`

基于 LangGraph StateGraph 实现的智能对话工作流。

### State 状态定义

**文件：** `app/graph/state.py`

```python
class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]  # 消息历史（累加）
    project_id: str                  # 项目ID（数据隔离）
    query: str                       # 用户提问
    image_url: str | None            # 截图URL
    intent: str | None               # 识别的意图类别
    intent_confidence: float         # 意图置信度（0-1）
    retrieval_strategy: Literal["vector", "graph", "hybrid"] | None  # 检索策略
    vector_results: list[dict]       # 向量检索结果
    graph_results: list[dict]        # 图谱检索结果
    combined_context: str            # 合并后的上下文文本
    answer: str                      # 生成的答案
    citations: list[dict]            # 引用来源
    hallucination_score: float       # 幻觉分数
    hallucination_passed: bool       # 幻觉检查是否通过
    error: str | None                # 错误信息
```

### 工作流图

**文件：** `app/graph/agent_graph.py`

```
                    ┌──────────────────┐
                    │ vision_preprocess │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ intent_recognition│
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ retrieval_router  │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐    │    ┌────────▼────────┐
     │ vector_retrieval │    │    │ graph_retrieval  │
     └────────┬────────┘    │    └────────┬────────┘
              │              │              │
              │    (hybrid)  └──────────────┘
              │              │
              └──────┬───────┘
                     │
            ┌────────▼─────────┐
            │ context_combiner  │
            └────────┬─────────┘
                     │
            ┌────────▼─────────┐
            │ answer_generation │
            └────────┬─────────┘
                     │
            ┌────────▼─────────┐
            │hallucination_check│
            └────────┬─────────┘
                     │
                    END
```

### 条件路由

| 路由节点 | 条件 | 目标节点 |
|----------|------|----------|
| `retrieval_router` | strategy = "graph" | → graph_retrieval |
| `retrieval_router` | strategy = "vector" 或 "hybrid" | → vector_retrieval |
| `vector_retrieval` | strategy = "hybrid" | → graph_retrieval（继续图谱检索） |
| `vector_retrieval` | strategy = "vector" | → context_combiner（跳过图谱） |
| `graph_retrieval` | （无条件） | → context_combiner |

### 节点详情

#### vision_preprocess（截图预处理）

**位置：** `agent_graph.py` 内联定义  
**输入：** image_url, query  
**输出：** query（增强后）

- 无 image_url 时直接跳过（返回 `{"messages": []}`）
- 有 image_url 时调用 `analyze_screenshot()` 解析截图内容
- 将截图描述附加到 query：`{原query}\n\n[截图上下文]: {截图分析结果}`
- 解析失败时静默跳过，不中断工作流

#### intent_recognition（意图识别）

**文件：** `app/graph/nodes/intent_recognition.py`  
**输入：** query  
**输出：** intent, intent_confidence

- 调用 LLM 判断用户意图类别
- LLM 输出格式：第一行意图类别，第二行置信度
- 意图类别：`operation_guide` / `process_inquiry` / `concept_explanation` / `troubleshooting` / `general_query`
- API Key 未配置时默认返回 `general_query`，置信度 0.5
- LLM 调用失败时容错返回默认值

#### retrieval_router（检索路由）

**文件：** `app/graph/nodes/retrieval_router.py`  
**输入：** intent  
**输出：** retrieval_strategy

意图与策略映射：

| 意图 | 策略 | 说明 |
|------|------|------|
| operation_guide | hybrid | 操作指引需同时查文档和图谱 |
| process_inquiry | graph | 流程查询仅需图谱关系 |
| concept_explanation | vector | 概念解释仅需文档片段 |
| troubleshooting | hybrid | 问题排查需同时查文档和图谱 |
| general_query | vector | 通用问答仅需文档片段 |

#### vector_retrieval（向量检索）

**文件：** `app/graph/nodes/vector_retrieval.py`  
**输入：** project_id, query  
**输出：** vector_results

- 集合名：`bga_{project_id（横线替换为下划线）}`
- 调用 MilvusRetriever.search()，top_k=5
- Milvus 不可用时返回空列表

#### graph_retrieval（图谱检索）

**文件：** `app/graph/nodes/graph_retrieval.py`  
**输入：** project_id, query, intent  
**输出：** graph_results

- 调用 Neo4jRetriever.search()，传入 intent 选择搜索策略
- Neo4j 不可用时返回空列表

#### context_combiner（上下文合并）

**文件：** `app/graph/nodes/context_combiner.py`  
**输入：** vector_results, graph_results, retrieval_strategy  
**输出：** combined_context

- vector/hybrid 策略：格式化向量结果为 `### 片段 N（来源: xxx, 相关度: 0.xx）`
- graph/hybrid 策略：格式化图谱结果为 `### 关系 N`
- 无结果时返回 "未找到相关上下文信息。"

#### answer_generation（答案生成）

**文件：** `app/graph/nodes/answer_generation.py`  
**输入：** combined_context, query, intent  
**输出：** answer, citations

- API Key 未配置时返回提示信息
- 调用 LLM 基于上下文生成回答
- 提取引用来源（vector_results 的 source + graph_results 的 source）
- LLM 调用失败时返回错误提示

#### hallucination_check（幻觉检查）

**文件：** `app/graph/nodes/hallucination_check.py`  
**输入：** combined_context, answer  
**输出：** hallucination_score, hallucination_passed

- 调用 LLM 审核回答是否基于上下文
- LLM 输出 "PASS" → score=0.0
- LLM 输出 "FAIL" → score=1.0
- LLM 输出数字 → score=该数字
- passed = score < 0.6
- API Key 未配置时默认 passed=True

---

## Ingestion 摄取管线

**目录：** `app/ingestion/`

将原始文档转化为可检索的向量嵌入和知识图谱实体。

### pipeline.py — 摄取管线编排

**文件：** `app/ingestion/pipeline.py`

`ingest_full_pipeline()` 编排完整摄取流程：

```
file_path
    │
    ▼
load_document() → 原始文档列表
    │
    ▼
split_documents() → 文档分块列表
    │
    ▼
ingest_to_milvus() → 向量写入 Milvus
    │
    ▼
extract_entities_from_documents() → 实体和关系
    │
    ▼
ingest_to_neo4j() → 图谱写入 Neo4j
```

返回值：
```json
{
  "project_id": "uuid",
  "vector": {
    "collection_name": "bga_xxx",
    "total_documents": 1,
    "total_chunks": 15
  },
  "graph": {
    "project_id": "uuid",
    "total_entities": 8,
    "total_relations": 12
  }
}
```

### document_loader.py — 文档加载

**文件：** `app/ingestion/document_loader.py`

`load_document(file_path) → list[Document]`

| 支持格式 | Loader 类 | 说明 |
|----------|-----------|------|
| `.pdf` | PyPDFLoader | PDF 文档解析 |
| `.txt` | TextLoader | 纯文本（UTF-8） |
| `.md` | TextLoader | Markdown（作为纯文本处理） |

不支持的格式抛出 `ValueError`。加载后为每个文档设置 `metadata.source` 为文件名。

### text_splitter.py — 文本分块

**文件：** `app/ingestion/text_splitter.py`

`split_documents(documents, chunk_size=500, chunk_overlap=50) → list[Document]`

使用 `RecursiveCharacterTextSplitter`，分隔符优先级：

```
\n\n  →  \n  →  。  →  ；  →  ，  →  空格  →  空字符串
```

分块后为每个 chunk 设置 `metadata.chunk_index`。

### vector_ingest.py — 向量摄取

**文件：** `app/ingestion/vector_ingest.py`

`ingest_to_milvus(file_path, project_id, chunk_size, chunk_overlap) → dict`

流程：
1. 加载文档 → 分块
2. 集合名：`bga_{project_id（横线替换为下划线）}`
3. 创建 MilvusRetriever 实例
4. 调用 `retriever.insert(data)` 批量写入

返回：`{collection_name, total_documents, total_chunks, chunks}`

### entity_extractor.py — 实体抽取

**文件：** `app/ingestion/entity_extractor.py`

`extract_entities_from_documents(documents) → dict`

- 逐文档分块调用 LLM 抽取实体和关系
- LLM 输出 JSON 格式：

```json
{
  "entities": [
    {"name": "实体名称", "category": "实体类别", "description": "实体描述"}
  ],
  "relations": [
    {"source": "源实体", "target": "目标实体", "type": "FLOW_TO", "description": "描述", "step_order": 1}
  ]
}
```

- 关系类型：`FLOW_TO`（流转）、`DEPENDS_ON`（依赖）、`RELATES_TO`（关联）
- JSON 解析失败时跳过该文档块

### graph_ingest.py — 图谱摄取

**文件：** `app/ingestion/graph_ingest.py`

`ingest_to_neo4j(project_id, entities) → dict`

- 调用 Neo4jRetriever.ingest_entities() 写入实体和关系
- 使用 MERGE 语句确保幂等性
- 完成后关闭 Neo4j 连接

返回：`{project_id, total_entities, total_relations}`

### ingest_worker.py — 摄取工作线程

**文件：** `app/ingestion/ingest_worker.py`

`IngestWorker` 类，在 production 模式下作为后台线程运行。

**工作机制：**
1. 连接 Redis
2. 轮询扫描 `ingest:queue:*` 键
3. 读取对应的 `ingest:pending:{documentId}` 获取任务载荷
4. 执行摄取管线
5. 成功后回调 Backend 更新文档状态为 completed
6. 失败后回调 Backend 更新文档状态为 failed
7. 清理 Redis 队列键

**Redis 键设计：**
- `ingest:queue:{documentId}` — 队列标记键（存在即有待处理任务）
- `ingest:pending:{documentId}` — 任务载荷（JSON，含 file_url、project_id 等）

---

## Retrieval 检索客户端

**目录：** `app/retrieval/`

### milvus_client.py — Milvus 检索客户端

**文件：** `app/retrieval/milvus_client.py`

`MilvusRetriever` 类，封装 Milvus 向量数据库的搜索和写入操作。

#### 嵌入模型

| EMBEDDING_PROVIDER | 实现类 | 模型 | 维度 | 需要 API Key |
|--------------------|--------|------|------|-------------|
| openai | OpenAIEmbeddings | text-embedding-3-small | 1536 | 是 |
| local | HuggingFaceEmbeddings | all-MiniLM-L6-v2 | 384 | 否 |

#### 方法

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `search(query, top_k=5)` | 查询文本, 返回数量 | list[dict] | 语义搜索：query → 嵌入 → Milvus 搜索 → 结果 |
| `insert(documents)` | 文档列表（content/source/chunk_index） | None | 批量插入：文本 → 嵌入 → 写入 Milvus |
| `_ensure_collection()` | — | None | 自动创建集合（若不存在） |

#### 集合 Schema

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INT64 | 主键（自增） |
| vector | FLOAT_VECTOR | 嵌入向量（维度 = EMBEDDING_DIMENSION） |
| content | VARCHAR(65535) | 文档内容 |
| source | VARCHAR(1024) | 来源文件名 |
| chunk_index | INT64 | 分块序号 |

**索引：** IVF_FLAT + COSINE 距离度量，nlist=128

#### 搜索结果格式

```python
{
    "content": "文档片段内容",
    "source": "来源文件名",
    "chunk_index": 0,
    "score": 0.85  # COSINE 相似度
}
```

### neo4j_client.py — Neo4j 检索客户端

**文件：** `app/retrieval/neo4j_client.py`

`Neo4jRetriever` 类，封装 Neo4j 知识图谱的搜索和写入操作。

#### 方法

| 方法 | 参数 | 返回 | 说明 |
|------|------|------|------|
| `search(query, intent="")` | 查询文本, 意图 | list[dict] | 知识图谱搜索，按 intent 选择策略 |
| `_search_process(session, query)` | 会话, 查询 | list[dict] | 流程搜索：匹配 FLOW_TO/RELATES_TO/DEPENDS_ON 关系 |
| `_search_general(session, query)` | 会话, 查询 | list[dict] | 通用搜索：匹配实体名称/描述 + 关联实体 |
| `ingest_entities(entities)` | 实体列表 | None | 写入实体和关系（MERGE 幂等） |
| `close()` | — | None | 关闭数据库连接 |

#### 流程搜索 Cypher

```cypher
MATCH (e1:Entity {project_id: $project_id})-[r:FLOW_TO|RELATES_TO|DEPENDS_ON]->(e2:Entity {project_id: $project_id})
WHERE e1.name CONTAINS $keyword OR e2.name CONTAINS $keyword
RETURN e1.name AS from_entity,
       type(r) AS relation_type,
       e2.name AS to_entity,
       r.description AS description,
       r.step_order AS step_order
ORDER BY r.step_order
LIMIT 10
```

#### 通用搜索 Cypher

```cypher
MATCH (e:Entity {project_id: $project_id})
WHERE e.name CONTAINS $keyword OR e.description CONTAINS $keyword
OPTIONAL MATCH (e)-[r]-(related:Entity {project_id: $project_id})
RETURN e.name AS entity_name,
       e.description AS entity_desc,
       collect({name: related.name, relation: type(r)}) AS related_entities
LIMIT 5
```

#### 关键词提取

`_extract_keyword(query)` 自动去除中文停用词（的、了、是、在、和、与、或、怎么、如何、什么、为什么、哪、哪些），保留有效字符。无有效字符时截取前 4 个字符。

#### 实体写入 Cypher

```cypher
MERGE (e:Entity {project_id: $project_id, name: $name})
SET e.description = $description,
    e.category = $category
```

关系写入：
```cypher
MATCH (a:Entity {project_id: $project_id, name: $source})
MATCH (b:Entity {project_id: $project_id, name: $target})
MERGE (a)-[r:FLOW_TO]->(b)
SET r.description = $description,
    r.step_order = $step_order
```

---

## Prompt 模板与安全

**目录：** `app/prompt/`

### templates.py — Prompt 模板

**文件：** `app/prompt/templates.py`

| 模板常量 | 用途 | 变量 |
|----------|------|------|
| `INTENT_RECOGNITION_SYSTEM` | 意图识别系统提示 | — |
| `INTENT_RECOGNITION_USER` | 意图识别用户提示 | `{query}` |
| `ANSWER_GENERATION_SYSTEM` | 答案生成系统提示 | `{intent}` |
| `ANSWER_GENERATION_USER` | 答案生成用户提示 | `{context}`, `{query}` |
| `HALLUCINATION_CHECK_SYSTEM` | 幻觉检查系统提示 | — |
| `HALLUCINATION_CHECK_USER` | 幻觉检查用户提示 | `{context}`, `{answer}` |

**意图类别定义（INTENT_RECOGNITION_SYSTEM）：**

| 类别 | 说明 |
|------|------|
| operation_guide | 操作指引类：如何操作某个功能、执行某个流程 |
| process_inquiry | 流程查询类：业务实体之间的流转关系 |
| concept_explanation | 概念解释类：业务概念、术语的含义 |
| troubleshooting | 问题排查类：操作问题或报错的排查解决 |
| general_query | 通用问答类：不属于以上任何类别 |

**答案生成要求（ANSWER_GENERATION_SYSTEM）：**

1. 操作指引 → 分步骤说明
2. 流程查询 → 完整流转路径
3. 概念解释 → 定义 + 举例
4. 问题排查 → 原因 + 解决方案
5. 必须基于上下文，不编造内容
6. 信息不足时明确告知
7. 引用信息标注来源

### injection_guard.py — 提示注入防护

**文件：** `app/prompt/injection_guard.py`

#### check_injection(text) → tuple[bool, str | None]

检测提示注入攻击，返回 `(is_injection, reason)`。

**检测模式：**

| 模式 | 说明 |
|------|------|
| `ignore (all)? previous (instructions\|prompts)` | 忽略先前指令 |
| `forget (all)? previous` | 遗忘先前内容 |
| `you are now a` | 角色切换 |
| `system:` | 系统提示注入 |
| `<system>` / `<instruction>` / `<prompt>` | 标签注入 |
| `jailbreak` | 越狱攻击 |
| `sudo` | 提权命令 |
| `rm -rf` | 删除命令 |
| `DROP TABLE` | SQL 注入 |
| `;--` | SQL 注释注入 |

#### sanitize_input(text) → str

清洗用户输入：
1. 去除所有 HTML 标签（`<[^>]+>`）
2. 去除控制字符（`\x00-\x08`, `\x0b`, `\x0c`, `\x0e-\x1f`, `\x7f`）
3. 去除首尾空白