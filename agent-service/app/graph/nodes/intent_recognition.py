from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config.settings import settings
from app.graph.state import AgentState
from app.prompt.templates import INTENT_RECOGNITION_SYSTEM, INTENT_RECOGNITION_USER


def _is_valid_api_key(key: str) -> bool:
    return bool(key and not key.startswith("sk-your"))


def intent_recognition(state: AgentState) -> dict:
    if not _is_valid_api_key(settings.LLM_API_KEY):
        return {"intent": "general_query", "intent_confidence": 0.5}

    try:
        llm = ChatOpenAI(
            model=settings.LLM_MODEL,
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL,
            temperature=0,
        )

        messages = [
            SystemMessage(content=INTENT_RECOGNITION_SYSTEM),
            HumanMessage(content=INTENT_RECOGNITION_USER.format(query=state["query"])),
        ]

        response = llm.invoke(messages)
        content = response.content.strip()

        lines = [line.strip() for line in content.split("\n") if line.strip()]
        intent = lines[0] if lines else "general_query"
        try:
            confidence = float(lines[1]) if len(lines) > 1 else 0.5
        except ValueError:
            confidence = 0.5
    except Exception:
        intent = "general_query"
        confidence = 0.5

    return {"intent": intent, "intent_confidence": confidence}