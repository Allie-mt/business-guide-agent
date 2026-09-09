import json

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langchain_core.documents import Document

from app.config.settings import settings

ENTITY_EXTRACTION_SYSTEM = """你是一个知识图谱构建专家。你需要从给定的文档片段中抽取业务实体和它们之间的关系。

请严格按照以下 JSON 格式输出：
{
  "entities": [
    {"name": "实体名称", "category": "实体类别", "description": "实体描述"}
  ],
  "relations": [
    {"source": "源实体名称", "target": "目标实体名称", "type": "关系类型", "description": "关系描述", "step_order": 0}
  ]
}

关系类型包括：
- FLOW_TO: 业务流转关系（如"客户建档后流转到线索"）
- DEPENDS_ON: 依赖关系（如"商机转化依赖客户审批"）
- RELATES_TO: 一般关联关系

step_order 表示在流程中的顺序，从1开始。

只抽取文档中明确提到的实体和关系，不要推测。如果文档中没有明确的实体关系，输出空数组。"""

ENTITY_EXTRACTION_USER = """请从以下文档片段中抽取业务实体和关系：

文档来源：{source}
文档内容：
{content}"""


async def extract_entities_from_documents(
    documents: list[Document],
) -> dict:
    llm = ChatOpenAI(
        model=settings.LLM_MODEL,
        api_key=settings.LLM_API_KEY,
        base_url=settings.LLM_BASE_URL,
        temperature=0,
    )

    all_entities = []
    all_relations = []

    for doc in documents:
        messages = [
            SystemMessage(content=ENTITY_EXTRACTION_SYSTEM),
            HumanMessage(
                content=ENTITY_EXTRACTION_USER.format(
                    source=doc.metadata.get("source", "未知"),
                    content=doc.page_content,
                )
            ),
        ]

        try:
            response = await llm.ainvoke(messages)
            content = response.content.strip()

            if content.startswith("```"):
                content = content.split("```")[1]
                if content.startswith("json"):
                    content = content[4:]
                content = content.strip()

            data = json.loads(content)
            all_entities.extend(data.get("entities", []))
            all_relations.extend(data.get("relations", []))
        except (json.JSONDecodeError, Exception):
            continue

    merged_entities = _merge_entities(all_entities, all_relations)

    return {"entities": merged_entities, "total_relations": len(all_relations)}


def _merge_entities(
    entities: list[dict],
    relations: list[dict],
) -> list[dict]:
    entity_map: dict[str, dict] = {}

    for entity in entities:
        name = entity["name"]
        if name not in entity_map:
            entity_map[name] = {
                "name": name,
                "category": entity.get("category", ""),
                "description": entity.get("description", ""),
                "relations": [],
            }
        else:
            if entity.get("description") and not entity_map[name]["description"]:
                entity_map[name]["description"] = entity["description"]

    for rel in relations:
        source = rel.get("source", "")
        if source in entity_map:
            entity_map[source]["relations"].append(
                {
                    "target": rel.get("target", ""),
                    "type": rel.get("type", "RELATES_TO"),
                    "description": rel.get("description", ""),
                    "step_order": rel.get("step_order", 0),
                }
            )

    return list(entity_map.values())