from app.config.settings import settings
from app.graph.state import AgentState
from app.retrieval.milvus_client import MilvusRetriever


async def vector_retrieval(state: AgentState) -> dict:
    project_id = state["project_id"]
    query = state["query"]
    collection_name = f"{settings.MILVUS_COLLECTION_PREFIX}{project_id.replace('-', '_')}"

    try:
        retriever = MilvusRetriever(collection_name=collection_name)
        results = await retriever.search(query=query, top_k=5)
    except Exception:
        results = []

    return {"vector_results": results}