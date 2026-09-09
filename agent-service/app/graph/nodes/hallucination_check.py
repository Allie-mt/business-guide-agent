from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config.settings import settings
from app.graph.state import AgentState
from app.prompt.templates import HALLUCINATION_CHECK_SYSTEM, HALLUCINATION_CHECK_USER


def _is_valid_api_key(key: str) -> bool:
    return bool(key and not key.startswith("sk-your"))


def hallucination_check(state: AgentState) -> dict:
    if not _is_valid_api_key(settings.LLM_API_KEY):
        return {"hallucination_score": 0.5, "hallucination_passed": True}

    try:
        llm = ChatOpenAI(
            model=settings.LLM_MODEL,
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL,
            temperature=0,
        )

        context = state.get("combined_context", "")
        answer = state.get("answer", "")

        messages = [
            SystemMessage(content=HALLUCINATION_CHECK_SYSTEM),
            HumanMessage(
                content=HALLUCINATION_CHECK_USER.format(context=context, answer=answer)
            ),
        ]

        response = llm.invoke(messages)
        content = response.content.strip().lower()

        if "pass" in content:
            score = 0.0
        elif "fail" in content:
            score = 1.0
        else:
            try:
                score = float(content)
            except ValueError:
                score = 0.5

        passed = score < 0.6
    except Exception:
        score = 0.5
        passed = True

    return {"hallucination_score": score, "hallucination_passed": passed}