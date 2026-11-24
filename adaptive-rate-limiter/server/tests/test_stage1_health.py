"""Stage 1 verification tests: FastAPI root, /api/health (healthy & Redis-down), and /api/products."""

from unittest.mock import AsyncMock

from fastapi.testclient import TestClient

from server.main import app
from shared.schemas import RedisStatus


def test_root_endpoint_returns_service_info() -> None:
    with TestClient(app) as client:
        response = client.get("/")
        assert response.status_code == 200
        body = response.json()
        assert body["stage"] == 1
        assert body["health_url"] == "/api/health"
        assert body["sample_endpoint"] == "/api/products"


def test_products_endpoint_returns_catalog() -> None:
    with TestClient(app) as client:
        response = client.get("/api/products")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 4
        assert len(body["items"]) == 4


def test_products_endpoint_filters_by_category() -> None:
    with TestClient(app) as client:
        response = client.get("/api/products?category=hardware")
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert all(item["category"] == "hardware" for item in body["items"])


def test_health_endpoint_reports_healthy_when_redis_connected() -> None:
    with TestClient(app) as client:
        app.state.redis_service.health_check = AsyncMock(
            return_value=RedisStatus(
                connected=True,
                host="127.0.0.1",
                port=6379,
                latency_ms=0.42,
                error=None,
            )
        )
        response = client.get("/api/health")
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "healthy"
        assert body["redis"]["connected"] is True
        assert body["redis"]["latency_ms"] == 0.42


def test_health_endpoint_reports_degraded_when_redis_disconnected() -> None:
    with TestClient(app) as client:
        app.state.redis_service.health_check = AsyncMock(
            return_value=RedisStatus(
                connected=False,
                host="127.0.0.1",
                port=6379,
                latency_ms=None,
                error="Connection refused",
            )
        )
        response = client.get("/api/health")
        assert response.status_code == 503
        body = response.json()
        assert body["status"] == "degraded"
        assert body["redis"]["connected"] is False
        assert body["redis"]["error"] == "Connection refused"
