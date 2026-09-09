#!/usr/bin/env python3
"""
基础设施连通性验证脚本。
启动 docker compose 后运行此脚本，验证所有服务是否可达。
用法: python scripts/check_infra.py
"""

import sys
import time


def check_postgres():
    try:
        import psycopg2
        conn = psycopg2.connect(
            host="localhost", port=5432,
            user="postgres", password="postgres",
            dbname="business_guide_agent",
        )
        conn.close()
        return True, "connected"
    except Exception as e:
        return False, str(e)


def check_redis():
    try:
        import redis
        r = redis.Redis(host="localhost", port=6379, decode_responses=True)
        r.ping()
        return True, "connected"
    except Exception as e:
        return False, str(e)


def check_milvus():
    try:
        from pymilvus import MilvusClient
        client = MilvusClient(uri="http://localhost:19530")
        client.list_collections()
        return True, "connected"
    except Exception as e:
        return False, str(e)


def check_neo4j():
    try:
        from neo4j import GraphDatabase
        driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "neo4jpassword"))
        with driver.session() as session:
            session.run("RETURN 1").consume()
        driver.close()
        return True, "connected"
    except Exception as e:
        return False, str(e)


def check_minio():
    try:
        from minio import Minio
        client = Minio("localhost:9000", access_key="minioadmin", secret_key="minioadmin", secure=False)
        client.bucket_exists("business-guide-agent")
        return True, "connected"
    except Exception as e:
        return False, str(e)


if __name__ == "__main__":
    checks = [
        ("PostgreSQL", check_postgres),
        ("Redis", check_redis),
        ("Milvus", check_milvus),
        ("Neo4j", check_neo4j),
        ("MinIO", check_minio),
    ]

    all_ok = True
    for name, fn in checks:
        ok, msg = fn()
        status = "✅" if ok else "❌"
        print(f"  {status} {name}: {msg}")
        if not ok:
            all_ok = False

    if all_ok:
        print("\n🎉 All infrastructure services are reachable!")
    else:
        print("\n⚠️  Some services are not reachable. Make sure docker compose is running.")
        sys.exit(1)