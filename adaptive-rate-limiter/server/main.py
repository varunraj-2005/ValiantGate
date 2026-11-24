"""FastAPI application entry point for the Adaptive Rate Limiter backend (Laptop 1)."""

from contextlib import asynccontextmanager
import logging
import sys
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Ensure project root (adaptive-rate-limiter/) is on sys.path for clean imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.config import get_settings
from server.routers.api_routes import router as api_router
from server.services.redis_service import RedisService
from shared.schemas import RootInfoResponse


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage startup and shutdown of backend dependencies (Redis connection pool)."""
    settings = get_settings()
    _configure_logging(settings.log_level)
    logger = logging.getLogger("server.main")

    redis_service = RedisService(settings=settings)
    await redis_service.connect()

    app.state.started_at = time.monotonic()
    app.state.api_paused = False
    app.state.redis_service = redis_service

    logger.info(
        "FastAPI backend initialized on %s:%s (algorithm=%s)",
        settings.server_host,
        settings.server_port,
        settings.default_algorithm.value,
    )
    try:
        yield
    finally:
        await redis_service.disconnect()
        logger.info("FastAPI backend shutdown complete.")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    settings = get_settings()

    application = FastAPI(
        title=settings.app_name,
        description=(
            "Traffic- and Resource-Aware Adaptive Rate Limiting System for Web APIs "
            "under Variable Workloads and Distributed Abuse."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(api_router)

    @application.get("/", response_model=RootInfoResponse, tags=["Root"])
    async def root() -> RootInfoResponse:
        return RootInfoResponse(
            service=settings.app_name,
            stage=1,
            version="0.1.0",
            docs_url="/docs",
            health_url="/api/health",
            sample_endpoint="/api/products",
        )

    return application


app = create_app()

if __name__ == "__main__":
    import uvicorn

    cfg = get_settings()
    uvicorn.run(
        "server.main:app",
        host=cfg.server_host,
        port=cfg.server_port,
        reload=False,
    )
