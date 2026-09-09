from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from app.config.settings import settings

VISION_SYSTEM = """你是一个业务系统界面分析专家。用户会提供一张系统截图，你需要从中识别出：
1. 当前所在的系统模块/页面名称
2. 界面上可见的操作按钮和菜单项
3. 当前页面展示的关键数据或状态
4. 用户可能正在执行的操作或遇到的困难

请用简洁的中文描述你看到的内容，以便后续检索和回答。"""

VISION_USER = """请分析这张系统截图，描述其中的界面元素和业务上下文："""


def _is_valid_api_key(key: str) -> bool:
    return bool(key and not key.startswith("sk-your"))


async def analyze_screenshot(image_url: str) -> str:
    if not _is_valid_api_key(settings.LLM_API_KEY):
        return "[截图分析不可用：LLM API Key 未配置]"

    try:
        llm = ChatOpenAI(
            model=settings.LLM_MODEL,
            api_key=settings.LLM_API_KEY,
            base_url=settings.LLM_BASE_URL,
            temperature=0,
        )

        message = HumanMessage(
            content=[
                {"type": "text", "text": VISION_USER},
                {"type": "image_url", "image_url": {"url": image_url}},
            ],
        )

        messages = [SystemMessage(content=VISION_SYSTEM), message]

        response = await llm.ainvoke(messages)
        return response.content.strip()
    except Exception as e:
        return f"[截图分析失败: {str(e)}]"