"""Initial API routes for Stage 1 verification (health check and sample endpoint)."""

from datetime import datetime, timezone
import time
from typing import Optional

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import JSONResponse

from server.config import get_settings
from shared.schemas import HealthResponse, ProductItem, ProductListResponse

router = APIRouter(prefix="/api", tags=["Core API"])

_SAMPLE_PRODUCTS: list[ProductItem] = [
    ProductItem(
        id=1,
        sku="ARL-1001",
        name="Edge Gateway Sensor",
        category="hardware",
        price_usd=129.99,
        in_stock=True,
    ),
    ProductItem(
        id=2,
        sku="ARL-1002",
        name="Telemetry Relay Module",
        category="hardware",
        price_usd=74.50,
        in_stock=True,
    ),
    ProductItem(
        id=3,
        sku="ARL-2001",
        name="API Traffic Analyzer License",
        category="software",
        price_usd=299.00,
        in_stock=True,
    ),
    ProductItem(
        id=4,
        sku="ARL-2002",
        name="Distributed Guardrail Pack",
        category="software",
        price_usd=149.00,
        in_stock=False,
    ),
]


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Check FastAPI and Redis health",
)
async def health_check(request: Request) -> JSONResponse:
    """Verify FastAPI availability, uptime, and Redis connectivity."""
    settings = get_settings()
    redis_service = request.app.state.redis_service
    redis_status = await redis_service.health_check()

    started_at: float = getattr(request.app.state, "started_at", time.monotonic())
    uptime_seconds = round(time.monotonic() - started_at, 2)
    is_healthy = redis_status.connected

    payload = HealthResponse(
        status="healthy" if is_healthy else "degraded",
        app_name=settings.app_name,
        environment=settings.app_env,
        uptime_seconds=uptime_seconds,
        active_algorithm=settings.default_algorithm,
        api_paused=getattr(request.app.state, "api_paused", False),
        redis=redis_status,
        timestamp=datetime.now(timezone.utc),
    )

    http_status = (
        status.HTTP_200_OK if is_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
    )
    return JSONResponse(status_code=http_status, content=payload.model_dump(mode="json"))


@router.get(
    "/products",
    response_model=ProductListResponse,
    summary="List sample products (Stage 1 test endpoint)",
)
async def list_products(
    category: Optional[str] = Query(
        default=None,
        min_length=1,
        max_length=50,
        description="Optional category filter (e.g. hardware, software)",
    ),
) -> ProductListResponse:
    """Return deterministic sample catalog items for API connectivity verification."""
    items = _SAMPLE_PRODUCTS
    if category:
        normalized = category.strip().lower()
        items = [item for item in _SAMPLE_PRODUCTS if item.category.lower() == normalized]

    return ProductListResponse(
        count=len(items),
        items=items,
        timestamp=datetime.now(timezone.utc),
    )
