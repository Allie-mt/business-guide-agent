from app.retrieval.neo4j_client import Neo4jRetriever


async def ingest_to_neo4j(
    project_id: str,
    entities: list[dict],
) -> dict:
    retriever = Neo4jRetriever(project_id=project_id)
    await retriever.ingest_entities(entities)
    await retriever.close()

    return {
        "project_id": project_id,
        "total_entities": len(entities),
        "total_relations": sum(len(e.get("relations", [])) for e in entities),
    }