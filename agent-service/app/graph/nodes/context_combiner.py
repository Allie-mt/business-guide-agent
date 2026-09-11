import logging

from app.graph.state import AgentState

logger = logging.getLogger(__name__)


def context_combiner(state: AgentState) -> dict:
    vector_results = state.get("vector_results", [])
    graph_results = state.get("graph_results", [])
    strategy = state.get("retrieval_strategy", "vector")

    context_parts = []

    if strategy in ("vector", "hybrid") and vector_results:
        context_parts.append("## 相关文档片段\n")
        for i, doc in enumerate(vector_results, 1):
            content = doc.get("content", "")
            source = doc.get("source", "未知来源")
            score = doc.get("score", 0)
            context_parts.append(f"### 片段 {i}（来源: {source}, 相关度: {score:.2f}）\n{content}\n")

    if strategy in ("graph", "hybrid") and graph_results:
        context_parts.append("## 知识图谱关系\n")
        for i, rel in enumerate(graph_results, 1):
            context_parts.append(f"### 关系 {i}\n{rel.get('description', str(rel))}\n")

    combined_context = "\n".join(context_parts) if context_parts else "未找到相关上下文信息。"

    logger.info(
        "上下文合并: strategy=%s, vector_results=%d, graph_results=%d, context_len=%d",
        strategy, len(vector_results), len(graph_results), len(combined_context),
    )

    return {"combined_context": combined_context}