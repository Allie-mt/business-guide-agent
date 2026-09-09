from neo4j import AsyncGraphDatabase, AsyncDriver

from app.config.settings import settings


class Neo4jRetriever:
    def __init__(self, project_id: str):
        self.project_id = project_id
        self._driver: AsyncDriver | None = None

    @property
    def driver(self) -> AsyncDriver:
        if self._driver is None:
            self._driver = AsyncGraphDatabase.driver(
                settings.NEO4J_URI,
                auth=(settings.NEO4J_USER, settings.NEO4J_PASSWORD),
            )
        return self._driver

    async def close(self):
        if self._driver is not None:
            await self._driver.close()
            self._driver = None

    async def search(self, query: str, intent: str = "") -> list[dict]:
        async with self.driver.session(database=settings.NEO4J_DATABASE) as session:
            if intent == "process_inquiry":
                return await self._search_process(session, query)
            return await self._search_general(session, query)

    async def _search_process(self, session, query: str) -> list[dict]:
        cypher = """
        MATCH (e1:Entity {project_id: $project_id})-[r:FLOW_TO|RELATES_TO|DEPENDS_ON]->(e2:Entity {project_id: $project_id})
        WHERE e1.name CONTAINS $keyword OR e2.name CONTAINS $keyword
        RETURN e1.name AS from_entity,
               type(r) AS relation_type,
               e2.name AS to_entity,
               r.description AS description,
               r.step_order AS step_order
        ORDER BY r.step_order
        LIMIT 10
        """
        keyword = self._extract_keyword(query)
        result = await session.run(cypher, project_id=self.project_id, keyword=keyword)
        records = await result.data()

        results = []
        for record in records:
            results.append(
                {
                    "from_entity": record["from_entity"],
                    "relation_type": record["relation_type"],
                    "to_entity": record["to_entity"],
                    "description": record.get("description", ""),
                    "step_order": record.get("step_order", 0),
                    "source": "knowledge_graph",
                }
            )
        return results

    async def _search_general(self, session, query: str) -> list[dict]:
        cypher = """
        MATCH (e:Entity {project_id: $project_id})
        WHERE e.name CONTAINS $keyword OR e.description CONTAINS $keyword
        OPTIONAL MATCH (e)-[r]-(related:Entity {project_id: $project_id})
        RETURN e.name AS entity_name,
               e.description AS entity_desc,
               collect({name: related.name, relation: type(r)}) AS related_entities
        LIMIT 5
        """
        keyword = self._extract_keyword(query)
        result = await session.run(cypher, project_id=self.project_id, keyword=keyword)
        records = await result.data()

        results = []
        for record in records:
            related = record.get("related_entities", [])
            related_str = ", ".join(
                f"{r['name']}({r['relation']})" for r in related if r["name"]
            )
            results.append(
                {
                    "description": f"{record['entity_name']}: {record.get('entity_desc', '')} → 关联: {related_str}",
                    "source": "knowledge_graph",
                }
            )
        return results

    @staticmethod
    def _extract_keyword(query: str) -> str:
        stop_words = {"的", "了", "是", "在", "和", "与", "或", "怎么", "如何", "什么", "为什么", "哪", "哪些"}
        words = [w for w in query if w not in stop_words and len(w) > 0]
        return "".join(words) if words else query[:4]

    async def ingest_entities(self, entities: list[dict]):
        async with self.driver.session(database=settings.NEO4J_DATABASE) as session:
            for entity in entities:
                cypher = """
                MERGE (e:Entity {project_id: $project_id, name: $name})
                SET e.description = $description,
                    e.category = $category
                """
                await session.run(
                    cypher,
                    project_id=self.project_id,
                    name=entity["name"],
                    description=entity.get("description", ""),
                    category=entity.get("category", ""),
                )

            for entity in entities:
                for rel in entity.get("relations", []):
                    cypher = """
                    MATCH (e1:Entity {project_id: $project_id, name: $from_name})
                    MATCH (e2:Entity {project_id: $project_id, name: $to_name})
                    MERGE (e1)-[r:RELATES_TO]->(e2)
                    SET r.description = $description,
                        r.step_order = $step_order
                    """
                    await session.run(
                        cypher,
                        project_id=self.project_id,
                        from_name=entity["name"],
                        to_name=rel["target"],
                        description=rel.get("description", ""),
                        step_order=rel.get("step_order", 0),
                    )