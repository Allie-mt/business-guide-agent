from app.graph.state import AgentState


INTENT_STRATEGY_MAP = {
    "operation_guide": "hybrid",
    "process_inquiry": "graph",
    "concept_explanation": "vector",
    "troubleshooting": "hybrid",
    "general_query": "vector",
}


def retrieval_router(state: AgentState) -> dict:
    intent = state.get("intent", "general_query")
    strategy = INTENT_STRATEGY_MAP.get(intent, "vector")
    return {"retrieval_strategy": strategy}