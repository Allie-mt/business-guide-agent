from langgraph.graph import StateGraph, END

from app.graph.state import AgentState
from app.graph.nodes.vision_parser import analyze_screenshot
from app.graph.nodes.intent_recognition import intent_recognition
from app.graph.nodes.retrieval_router import retrieval_router
from app.graph.nodes.vector_retrieval import vector_retrieval
from app.graph.nodes.graph_retrieval import graph_retrieval
from app.graph.nodes.context_combiner import context_combiner
from app.graph.nodes.answer_generation import answer_generation
from app.graph.nodes.hallucination_check import hallucination_check


async def vision_preprocess(state: AgentState) -> dict:
    image_url = state.get("image_url")
    if not image_url:
        return {"messages": []}

    try:
        image_context = await analyze_screenshot(image_url)
        enhanced_query = f"{state['query']}\n\n[截图上下文]: {image_context}"
        return {"query": enhanced_query, "messages": []}
    except Exception:
        return {"messages": []}


def _route_after_router(state: AgentState) -> str:
    strategy = state.get("retrieval_strategy", "vector")
    if strategy == "graph":
        return "graph_retrieval"
    return "vector_retrieval"


def _route_after_vector(state: AgentState) -> str:
    strategy = state.get("retrieval_strategy", "vector")
    if strategy == "hybrid":
        return "graph_retrieval"
    return "context_combiner"


def build_agent_graph() -> StateGraph:
    graph = StateGraph(AgentState)

    graph.add_node("vision_preprocess", vision_preprocess)
    graph.add_node("intent_recognition", intent_recognition)
    graph.add_node("retrieval_router", retrieval_router)
    graph.add_node("vector_retrieval", vector_retrieval)
    graph.add_node("graph_retrieval", graph_retrieval)
    graph.add_node("context_combiner", context_combiner)
    graph.add_node("answer_generation", answer_generation)
    graph.add_node("hallucination_check", hallucination_check)

    graph.set_entry_point("vision_preprocess")
    graph.add_edge("vision_preprocess", "intent_recognition")
    graph.add_edge("intent_recognition", "retrieval_router")

    graph.add_conditional_edges(
        "retrieval_router",
        _route_after_router,
        {
            "vector_retrieval": "vector_retrieval",
            "graph_retrieval": "graph_retrieval",
        },
    )

    graph.add_conditional_edges(
        "vector_retrieval",
        _route_after_vector,
        {
            "graph_retrieval": "graph_retrieval",
            "context_combiner": "context_combiner",
        },
    )

    graph.add_edge("graph_retrieval", "context_combiner")

    graph.add_edge("context_combiner", "answer_generation")
    graph.add_edge("answer_generation", "hallucination_check")
    graph.add_edge("hallucination_check", END)

    return graph


agent_graph = build_agent_graph()
agent_app = agent_graph.compile()