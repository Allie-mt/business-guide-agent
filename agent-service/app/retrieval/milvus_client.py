import logging

from pymilvus import MilvusClient, DataType
from langchain_openai import OpenAIEmbeddings
from langchain_community.embeddings import HuggingFaceEmbeddings

from app.config.settings import settings

logger = logging.getLogger(__name__)


def _get_embedding():
    if settings.EMBEDDING_PROVIDER == "local":
        return HuggingFaceEmbeddings(
            model_name=settings.EMBEDDING_MODEL,
        )
    return OpenAIEmbeddings(
        model=settings.EMBEDDING_MODEL,
        api_key=settings.EMBEDDING_API_KEY,
        base_url=settings.EMBEDDING_BASE_URL,
    )


class MilvusRetriever:
    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        self._client: MilvusClient | None = None
        self._embedding = _get_embedding()

    @property
    def client(self) -> MilvusClient:
        if self._client is None:
            self._client = MilvusClient(
                uri=f"http://{settings.MILVUS_HOST}:{settings.MILVUS_PORT}"
            )
        return self._client

    def _ensure_collection(self):
        if self.client.has_collection(self.collection_name):
            return

        schema = self.client.create_schema(auto_id=True, enable_dynamic_field=True)
        schema.add_field("id", DataType.INT64, is_primary=True)
        schema.add_field("vector", DataType.FLOAT_VECTOR, dim=settings.EMBEDDING_DIMENSION)
        schema.add_field("content", DataType.VARCHAR, max_length=65535)
        schema.add_field("source", DataType.VARCHAR, max_length=1024)
        schema.add_field("chunk_index", DataType.INT64)

        index_params = self.client.prepare_index_params()
        index_params.add_index(
            "vector",
            index_type="IVF_FLAT",
            metric_type="COSINE",
            params={"nlist": 128},
        )

        self.client.create_collection(
            collection_name=self.collection_name,
            schema=schema,
            index_params=index_params,
        )

    async def search(self, query: str, top_k: int = 5) -> list[dict]:
        if not self.client.has_collection(self.collection_name):
            logger.warning("Milvus collection不存在: %s", self.collection_name)
            return []

        self._ensure_collection()

        query_vector = await self._embedding.aembed_query(query)
        logger.info(
            "Milvus搜索: collection=%s, query_vector_dim=%d, top_k=%d",
            self.collection_name, len(query_vector), top_k,
        )

        results = self.client.search(
            collection_name=self.collection_name,
            data=[query_vector],
            limit=top_k,
            output_fields=["content", "source", "chunk_index"],
        )

        documents = []
        for hits in results:
            for hit in hits:
                entity = hit["entity"]
                documents.append(
                    {
                        "content": entity.get("content", ""),
                        "source": entity.get("source", ""),
                        "chunk_index": entity.get("chunk_index", 0),
                        "score": hit.get("distance", 0),
                    }
                )

        return documents

    def insert(self, documents: list[dict]):
        self._ensure_collection()

        texts = [doc["content"] for doc in documents]
        vectors = self._embedding.embed_documents(texts)

        data = []
        for doc, vector in zip(documents, vectors):
            data.append(
                {
                    "vector": vector,
                    "content": doc["content"],
                    "source": doc.get("source", ""),
                    "chunk_index": doc.get("chunk_index", 0),
                }
            )

        self.client.insert(collection_name=self.collection_name, data=data)

    def drop_collection(self):
        if self.client.has_collection(self.collection_name):
            self.client.drop_collection(self.collection_name)