import logging

from app.config.settings import settings
from app.graph.state import AgentState
from app.retrieval.milvus_client import MilvusRetriever

logger = logging.getLogger(__name__)

MIN_RELEVANCE_SCORE = 0.3


async def vector_retrieval(state: AgentState) -> dict:
    project_id = state["project_id"]
    query = state["query"]
    collection_name = f"{settings.MILVUS_COLLECTION_PREFIX}{project_id.replace('-', '_')}"

    try:
        retriever = MilvusRetriever(collection_name=collection_name)
        results = await retriever.search(query=query, top_k=5)
        logger.info(
            "向量检索完成: collection=%s, query=%s, 原始结果数=%d",
            collection_name, query[:50], len(results),
        )
        for i, r in enumerate(results):
            logger.info(
                "  结果[%d]: score=%.4f, source=%s, content=%s",
                i, r.get("score", 0), r.get("source", ""), r.get("content", "")[:80],
            )
    except Exception as e:
        logger.error("向量检索失败: collection=%s, error=%s", collection_name, str(e))
        results = []

    filtered = [r for r in results if r.get("score", 0) >= MIN_RELEVANCE_SCORE]
    if len(filtered) < len(results):
        logger.info(
            "相关性过滤: %d/%d 条结果超过阈值 %.2f",
            len(filtered), len(results), MIN_RELEVANCE_SCORE,
        )

    return {"vector_results": filtered}