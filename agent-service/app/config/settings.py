from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    NODE_ENV: str = "development"
    LOG_LEVEL: str = "info"

    AGENT_SERVICE_HOST: str = "0.0.0.0"
    AGENT_SERVICE_PORT: int = 8000

    LLM_PROVIDER: str = "openai"
    LLM_MODEL: str = "gpt-4o"
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://api.openai.com/v1"
    LLM_TEMPERATURE: float = 0.1

    EMBEDDING_PROVIDER: str = "openai"
    EMBEDDING_MODEL: str = "text-embedding-3-small"
    EMBEDDING_API_KEY: str = ""
    EMBEDDING_BASE_URL: str = "https://api.openai.com/v1"
    EMBEDDING_DIMENSION: int = 1536

    MILVUS_HOST: str = "localhost"
    MILVUS_PORT: int = 19530
    MILVUS_COLLECTION_PREFIX: str = "bga_"

    NEO4J_URI: str = "bolt://localhost:7687"
    NEO4J_USER: str = "neo4j"
    NEO4J_PASSWORD: str = ""
    NEO4J_DATABASE: str = "neo4j"

    REDIS_HOST: str = "localhost"
    REDIS_PORT: int = 6379
    REDIS_PASSWORD: str = ""

    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "business-guide-agent"
    MINIO_USE_SSL: bool = False

    model_config = {"env_file": ["../.env", ".env"], "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()