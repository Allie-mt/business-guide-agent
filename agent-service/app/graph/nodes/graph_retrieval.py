from app.config.settings import settings
from app.graph.state import AgentState
from app.retrieval.neo4j_client import Neo4jRetriever


async def graph_retrieval(state: AgentState) -> dict:
    project_id = state["project_id"]
    query = state["query"]
    intent = state.get("intent", "")

    try:
        retriever = Neo4jRetriever(project_id=project_id)
        results = await retriever.search(query=query, intent=intent)
    except Exception:
        results = []

    return {"graph_results": results}