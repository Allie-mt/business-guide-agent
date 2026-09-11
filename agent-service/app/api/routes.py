import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.prompt.injection_guard import check_injection, sanitize_input
from app.graph.agent_graph import agent_app
from app.config.settings import settings

router = APIRouter()


class ChatRequest(BaseModel):
    project_id: str = Field(..., description="项目ID，用于数据隔离")
    query: str = Field(..., min_length=1, description="用户提问")
    image_url: str | None = Field(None, description="可选的系统截图URL")


class ChatResponse(BaseModel):
    answer: str
    intent: str | None = None
    intent_confidence: float = 0
    retrieval_strategy: str | None = None
    citations: list[dict] = Field(default_factory=list)
    hallucination_score: float = 0
    hallucination_passed: bool = True


class IngestRequest(BaseModel):
    project_id: str
    file_path: str
    chunk_size: int = 500
    chunk_overlap: int = 50
    extract_graph: bool = True


class IngestResponse(BaseModel):
    collection_name: str
    total_documents: int
    total_chunks: int


class GraphIngestRequest(BaseModel):
    project_id: str
    entities: list[dict]


class GraphIngestResponse(BaseModel):
    project_id: str
    total_entities: int
    total_relations: int


class StreamRequest(BaseModel):
    project_id: str = Field(..., description="项目ID")
    query: str = Field(..., min_length=1, description="用户提问")
    image_url: str | None = Field(None, description="可选的系统截图URL")


class PipelineIngestRequest(BaseModel):
    project_id: str = Field(..., description="项目ID")
    file_url: str = Field(..., description="文件下载URL（MinIO预签名地址）")
    document_id: str | None = Field(None, description="文档ID，用于回调状态更新")
    mime_type: str | None = Field(None, description="文件MIME类型")
    original_name: str | None = Field(None, description="原始文件名")
    chunk_size: int = 500
    chunk_overlap: int = 50
    extract_graph: bool = True


def _build_initial_state(request: ChatRequest | StreamRequest) -> dict:
    sanitized_query = sanitize_input(request.query)
    return {
        "messages": [],
        "project_id": request.project_id,
        "query": sanitized_query,
        "image_url": request.image_url,
        "intent": None,
        "intent_confidence": 0,
        "retrieval_strategy": None,
        "vector_results": [],
        "graph_results": [],
        "combined_context": "",
        "answer": "",
        "citations": [],
        "hallucination_score": 0,
        "hallucination_passed": True,
        "error": None,
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    is_injection, reason = check_injection(request.query)
    if is_injection:
        raise HTTPException(status_code=400, detail=f"输入安全检查未通过: {reason}")

    initial_state = _build_initial_state(request)

    try:
        result = await agent_app.ainvoke(initial_state)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent 执行失败: {str(e)}")

    return ChatResponse(
        answer=result.get("answer", ""),
        intent=result.get("intent"),
        intent_confidence=result.get("intent_confidence", 0),
        retrieval_strategy=result.get("retrieval_strategy"),
        citations=result.get("citations", []),
        hallucination_score=result.get("hallucination_score", 0),
        hallucination_passed=result.get("hallucination_passed", True),
    )


@router.post("/chat/stream")
async def chat_stream(request: StreamRequest):
    is_injection, reason = check_injection(request.query)
    if is_injection:
        raise HTTPException(status_code=400, detail=f"输入安全检查未通过: {reason}")

    initial_state = _build_initial_state(request)

    async def event_generator():
        streamed_answer = ""
        try:
            async for event in agent_app.astream_events(initial_state, version="v2"):
                kind = event.get("event", "")
                data = event.get("data", {})
                name = event.get("name", "")

                if kind == "on_chain_stream" and name == "answer_generation":
                    chunk = data.get("chunk", {})
                    if isinstance(chunk, dict) and "answer" in chunk:
                        full_answer = chunk["answer"]
                        if len(full_answer) > len(streamed_answer):
                            new_token = full_answer[len(streamed_answer):]
                            streamed_answer = full_answer
                            yield f"data: {json.dumps({'type': 'token', 'content': new_token})}\n\n"

                elif kind == "on_chain_end" and name == "answer_generation":
                    output = data.get("output", {})
                    if isinstance(output, dict):
                        final_answer = output.get("answer", "")
                        if final_answer and not streamed_answer:
                            yield f"data: {json.dumps({'type': 'answer', 'content': final_answer})}\n\n"

                elif kind == "on_chain_end" and name == "intent_recognition":
                    output = data.get("output", {}) if isinstance(data.get("output"), dict) else {}
                    if output:
                        yield f"data: {json.dumps({'type': 'intent', 'data': output})}\n\n"

                elif kind == "on_chain_end" and name == "hallucination_check":
                    output = data.get("output", {}) if isinstance(data.get("output"), dict) else {}
                    if output:
                        yield f"data: {json.dumps({'type': 'hallucination', 'data': output})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/ingest/vector", response_model=IngestResponse)
async def ingest_vector(request: IngestRequest):
    from app.ingestion.vector_ingest import ingest_to_milvus

    try:
        result = await ingest_to_milvus(
            file_path=request.file_path,
            project_id=request.project_id,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"文档摄入失败: {str(e)}")

    return IngestResponse(
        collection_name=result["collection_name"],
        total_documents=result["total_documents"],
        total_chunks=result["total_chunks"],
    )


@router.post("/ingest/full")
async def ingest_full(request: IngestRequest):
    from app.ingestion.pipeline import ingest_full_pipeline

    try:
        result = await ingest_full_pipeline(
            file_path=request.file_path,
            project_id=request.project_id,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            extract_graph=request.extract_graph,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"联合摄入失败: {str(e)}")

    return result


@router.post("/ingest/graph", response_model=GraphIngestResponse)
async def ingest_graph(request: GraphIngestRequest):
    from app.ingestion.graph_ingest import ingest_to_neo4j

    try:
        result = await ingest_to_neo4j(
            project_id=request.project_id,
            entities=request.entities,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图谱摄入失败: {str(e)}")

    return GraphIngestResponse(**result)


@router.post("/ingest/pipeline")
async def ingest_pipeline(request: PipelineIngestRequest):
    import tempfile
    import httpx
    import os
    from app.ingestion.pipeline import ingest_full_pipeline

    MIME_TO_EXT = {
        "application/pdf": ".pdf",
        "text/plain": ".txt",
        "text/markdown": ".md",
    }

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(request.file_url)
            resp.raise_for_status()

        suffix = None
        if request.mime_type and request.mime_type in MIME_TO_EXT:
            suffix = MIME_TO_EXT[request.mime_type]
        if not suffix and request.original_name and "." in request.original_name:
            ext = request.original_name.rsplit(".", 1)[-1].lower()
            if ext in ("pdf", "txt", "md"):
                suffix = f".{ext}"
        if not suffix:
            url_path = request.file_url.split("?")[0]
            if "." in url_path:
                ext = url_path.rsplit(".", 1)[-1].lower()
                if ext in ("pdf", "txt", "md"):
                    suffix = f".{ext}"
        if not suffix:
            suffix = ".pdf"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(resp.content)
            tmp_path = tmp.name

        result = await ingest_full_pipeline(
            file_path=tmp_path,
            project_id=request.project_id,
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            extract_graph=request.extract_graph,
        )

        os.unlink(tmp_path)

        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline 摄取失败: {str(e)}")


class DebugRetrievalRequest(BaseModel):
    project_id: str = Field(..., description="项目ID")
    query: str = Field(..., description="测试查询")
    top_k: int = Field(5, description="返回数量")


@router.post("/debug/retrieval")
async def debug_retrieval(request: DebugRetrievalRequest):
    from app.retrieval.milvus_client import MilvusRetriever
    from pymilvus import MilvusClient as PyMilvusClient

    collection_name = f"{settings.MILVUS_COLLECTION_PREFIX}{request.project_id.replace('-', '_')}"

    milvus_client = PyMilvusClient(
        uri=f"http://{settings.MILVUS_HOST}:{settings.MILVUS_PORT}"
    )

    collection_exists = milvus_client.has_collection(collection_name)

    collection_info = {}
    if collection_exists:
        col_stats = milvus_client.get_collection_stats(collection_name)
        collection_info = {
            "name": collection_name,
            "exists": True,
            "row_count": col_stats.get("row_count", 0) if isinstance(col_stats, dict) else str(col_stats),
        }
    else:
        collection_info = {"name": collection_name, "exists": False, "row_count": 0}

    all_collections = milvus_client.list_collections()

    search_results = []
    if collection_exists:
        try:
            retriever = MilvusRetriever(collection_name=collection_name)
            search_results = await retriever.search(query=request.query, top_k=request.top_k)
        except Exception as e:
            search_results = [{"error": str(e)}]

    return {
        "collection": collection_info,
        "all_collections": all_collections,
        "search_results": search_results,
        "milvus_host": settings.MILVUS_HOST,
        "milvus_port": settings.MILVUS_PORT,
        "embedding_provider": settings.EMBEDDING_PROVIDER,
        "embedding_model": settings.EMBEDDING_MODEL,
        "embedding_dimension": settings.EMBEDDING_DIMENSION,
    }