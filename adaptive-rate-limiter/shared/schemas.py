"""Shared Pydantic v2 schemas for API requests and responses."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

from shared.constants import RateLimitAlgorithm


class RedisStatus(BaseModel):
    """Redis connectivity and latency status."""

    connected: bool
    host: str
    port: int
    latency_ms: Optional[float] = None
    error: Optional[str] = None


class HealthResponse(BaseModel):
    """Response model for GET /api/health."""

    status: str = Field(..., description="Overall service health: 'healthy' or 'degraded'")
    app_name: str
    environment: str
    uptime_seconds: float
    active_algorithm: RateLimitAlgorithm
    api_paused: bool = False
    redis: RedisStatus
    timestamp: datetime


class RootInfoResponse(BaseModel):
    """Response model for GET /."""

    service: str
    stage: int
    version: str
    docs_url: str
    health_url: str
    sample_endpoint: str


class ProductItem(BaseModel):
    """Sample product entity for initial API verification."""

    id: int
    sku: str
    name: str
    category: str
    price_usd: float
    in_stock: bool


class ProductListResponse(BaseModel):
    """Response model for GET /api/products."""

    count: int
    items: list[ProductItem]
    timestamp: datetime
