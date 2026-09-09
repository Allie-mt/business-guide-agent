import json
import asyncio
import logging

import redis as redis_sync

from app.config.settings import settings

logger = logging.getLogger(__name__)

INGEST_QUEUE_PREFIX = "ingest:queue:"
INGEST_PENDING_PREFIX = "ingest:pending:"


class IngestWorker:
    def __init__(self):
        self._redis = redis_sync.Redis(
            host=settings.REDIS_HOST,
            port=settings.REDIS_PORT,
            password=settings.REDIS_PASSWORD or None,
            decode_responses=True,
        )
        self._running = False

    def start(self):
        self._running = True
        logger.info("IngestWorker started, polling for pending ingest tasks...")
        while self._running:
            try:
                self._poll_and_process()
            except Exception as e:
                logger.error(f"IngestWorker error: {e}")
                import time
                time.sleep(5)

    def stop(self):
        self._running = False

    def _poll_and_process(self):
        cursor = "0"
        while self._running:
            cursor, keys = self._redis.scan(
                cursor=cursor,
                match=f"{INGEST_QUEUE_PREFIX}*",
                count=50,
            )
            for key in keys:
                document_id = key.replace(INGEST_QUEUE_PREFIX, "")
                pending_key = f"{INGEST_PENDING_PREFIX}{document_id}"
                payload_str = self._redis.get(pending_key)
                if not payload_str:
                    self._redis.delete(key)
                    continue

                payload = json.loads(payload_str)
                logger.info(f"Processing ingest for document: {document_id}")

                try:
                    result = asyncio.run(self._process_document(payload))
                    logger.info(f"Ingest completed for {document_id}: {result}")
                except Exception as e:
                    logger.error(f"Ingest failed for {document_id}: {e}")

                self._redis.delete(key)
                self._redis.delete(pending_key)

            if cursor == "0":
                import time
                time.sleep(2)

    async def _process_document(self, payload: dict) -> dict:
        from app.ingestion.vector_ingest import ingest_to_milvus

        project_id = payload["projectId"]
        storage_key = payload["storageKey"]

        local_path = await self._download_from_minio(storage_key)

        result = await ingest_to_milvus(
            file_path=local_path,
            project_id=project_id,
        )

        import os
        if os.path.exists(local_path):
            os.remove(local_path)

        return result

    async def _download_from_minio(self, storage_key: str) -> str:
        import os
        import boto3
        from botocore.config import Config

        endpoint = settings.MINIO_ENDPOINT
        s3 = boto3.client(
            "s3",
            endpoint_url=f"http://{endpoint}" if not settings.MINIO_USE_SSL else f"https://{endpoint}",
            aws_access_key_id=settings.MINIO_ACCESS_KEY,
            aws_secret_access_key=settings.MINIO_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
        )

        tmp_dir = "/tmp/bga_ingest"
        os.makedirs(tmp_dir, exist_ok=True)
        local_path = os.path.join(tmp_dir, storage_key.replace("/", "_"))
        os.makedirs(os.path.dirname(local_path), exist_ok=True)

        s3.download_file(settings.MINIO_BUCKET, storage_key, local_path)
        return local_path