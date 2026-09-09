import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router
from app.config.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    worker_thread = None
    if settings.NODE_ENV == "production":
        from app.ingestion.ingest_worker import IngestWorker

        worker = IngestWorker()
        worker_thread = threading.Thread(target=worker.start, daemon=True)
        worker_thread.start()

    yield

    if worker_thread is not None:
        worker.stop()


app = FastAPI(
    title="Business Guide Agent Service",
    description="智能业务指引Agent - 基于LangGraph + Milvus + Neo4j",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.get("/health")
async def health():
    checks = {"milvus": False, "neo4j": False, "redis": False}

    try:
        from app.retrieval.milvus_client import get_milvus_client
        client = get_milvus_client()
        client.list_collections()
        checks["milvus"] = True
    except Exception:
        pass

    try:
        from app.retrieval.neo4j_client import get_neo4j_driver
        driver = get_neo4j_driver()
        with driver.session() as session:
            session.run("RETURN 1").consume()
        checks["neo4j"] = True
    except Exception:
        pass

    try:
        import redis
        r = redis.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
        )
        r.ping()
        checks["redis"] = True
    except Exception:
        pass

    all_healthy = all(checks.values())
    return {
        "status": "ok" if all_healthy else "degraded",
        "version": "0.1.0",
        "checks": checks,
    }