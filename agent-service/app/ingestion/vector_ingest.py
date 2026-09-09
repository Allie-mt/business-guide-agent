from langchain_core.documents import Document

from app.config.settings import settings
from app.retrieval.milvus_client import MilvusRetriever
from app.ingestion.document_loader import load_document
from app.ingestion.text_splitter import split_documents


async def ingest_to_milvus(
    file_path: str,
    project_id: str,
    chunk_size: int = 500,
    chunk_overlap: int = 50,
) -> dict:
    documents = await load_document(file_path)
    chunks = split_documents(documents, chunk_size=chunk_size, chunk_overlap=chunk_overlap)

    collection_name = f"{settings.MILVUS_COLLECTION_PREFIX}{project_id.replace('-', '_')}"
    retriever = MilvusRetriever(collection_name=collection_name)

    data = []
    for chunk in chunks:
        data.append(
            {
                "content": chunk.page_content,
                "source": chunk.metadata.get("source", ""),
                "chunk_index": chunk.metadata.get("chunk_index", 0),
            }
        )

    retriever.insert(data)

    return {
        "collection_name": collection_name,
        "total_documents": len(documents),
        "total_chunks": len(chunks),
        "chunks": chunks,
    }