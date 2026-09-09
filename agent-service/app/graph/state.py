from __future__ import annotations

from typing import TypedDict, Annotated, Literal
from langgraph.graph.message import add_messages
from langchain_core.messages import BaseMessage


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    project_id: str
    query: str
    image_url: str | None
    intent: str | None
    intent_confidence: float
    retrieval_strategy: Literal["vector", "graph", "hybrid"] | None
    vector_results: list[dict]
    graph_results: list[dict]
    combined_context: str
    answer: str
    citations: list[dict]
    hallucination_score: float
    hallucination_passed: bool
    error: str | None