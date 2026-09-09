from app.ingestion.vector_ingest import ingest_to_milvus
from app.ingestion.entity_extractor import extract_entities_from_documents
from app.ingestion.graph_ingest import ingest_to_neo4j


async def ingest_full_pipeline(
    file_path: str,
    project_id: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
    extract_graph: bool = True,
) -> dict:
    vector_result = await ingest_to_milvus(
        file_path=file_path,
        project_id=project_id,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
    )

    graph_result = None
    if extract_graph and vector_result.get("chunks"):
        extraction = await extract_entities_from_documents(
            documents=vector_result["chunks"],
        )

        if extraction["entities"]:
            graph_result = await ingest_to_neo4j(
                project_id=project_id,
                entities=extraction["entities"],
            )

    return {
        "project_id": project_id,
        "vector": {
            "collection_name": vector_result["collection_name"],
            "total_documents": vector_result["total_documents"],
            "total_chunks": vector_result["total_chunks"],
        },
        "graph": graph_result,
    }