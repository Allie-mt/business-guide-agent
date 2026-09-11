import logging

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config.settings import settings
from app.graph.state import AgentState
from app.prompt.templates import ANSWER_GENERATION_SYSTEM, ANSWER_GENERATION_USER

logger = logging.getLogger(__name__)


def _is_valid_api_key(key: str) -> bool:
    return bool(key and not key.startswith("sk-your"))


async def answer_generation(state: AgentState):
    if not _is_valid_api_key(settings.LLM_API_KEY):
        yield {
            "answer": "⚠️ LLM API Key 未配置。请在 .env 文件中设置 LLM_API_KEY 为有效的 OpenAI API Key 后重试。",
            "citations": [],
        }
        return

    try:
        llm = ChatOpenAI(
            model=settings.LLM_MODEL,
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL,
            temperature=settings.LLM_TEMPERATURE,
            streaming=True,
        )

        context = state.get("combined_context", "")
        query = state["query"]
        intent = state.get("intent", "general_query")

        messages = [
            SystemMessage(content=ANSWER_GENERATION_SYSTEM.format(intent=intent)),
            HumanMessage(
                content=ANSWER_GENERATION_USER.format(context=context, query=query)
            ),
        ]

        answer = ""
        async for chunk in llm.astream(messages):
            token = chunk.content
            if token:
                answer += token
                yield {"answer": answer}

        answer = answer.strip()
    except Exception as e:
        logger.error("LLM 流式调用失败: %s", str(e))
        answer = f"⚠️ LLM 调用失败: {str(e)}"
        yield {"answer": answer}

    citations = _extract_citations(state)
    yield {"answer": answer, "citations": citations}


def _extract_citations(state: AgentState) -> list[dict]:
    citations = []
    for doc in state.get("vector_results", []):
        if "source" in doc:
            citations.append(
                {"type": "document", "source": doc["source"], "score": doc.get("score", 0)}
            )
    for rel in state.get("graph_results", []):
        if "source" in rel:
            citations.append(
                {"type": "graph", "source": rel["source"]}
            )
    return citations