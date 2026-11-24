"""Asynchronous Redis connection manager and health-check service."""

import logging
import time
from typing import Optional

import redis.asyncio as aioredis
from redis.exceptions import RedisError

from server.config import Settings
from shared.schemas import RedisStatus

logger = logging.getLogger(__name__)


class RedisService:
    """Manages an async Redis connection pool and safe health checks."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client: Optional[aioredis.Redis] = None

    @property
    def client(self) -> Optional[aioredis.Redis]:
        """Return the active async Redis client if initialized."""
        return self._client

    async def connect(self) -> bool:
        """Initialize the Redis connection pool and verify connectivity with PING."""
        password = self._settings.redis_password or None
        self._client = aioredis.Redis(
            host=self._settings.redis_host,
            port=self._settings.redis_port,
            db=self._settings.redis_db,
            password=password,
            socket_timeout=self._settings.redis_socket_timeout,
            socket_connect_timeout=self._settings.redis_socket_timeout,
            decode_responses=True,
            max_connections=100,
        )

        status = await self.health_check()
        if status.connected:
            logger.info(
                "Connected to Redis at %s:%s (db=%s, latency=%.2f ms)",
                self._settings.redis_host,
                self._settings.redis_port,
                self._settings.redis_db,
                status.latency_ms or 0.0,
            )
            return True

        logger.warning(
            "Redis is unreachable at %s:%s (%s). Server will report degraded health until Redis starts.",
            self._settings.redis_host,
            self._settings.redis_port,
            status.error,
        )
        return False

    async def disconnect(self) -> None:
        """Close the Redis connection pool cleanly."""
        if self._client is not None:
            try:
                await self._client.aclose()
                logger.info("Redis connection pool closed.")
            except RedisError as exc:
                logger.warning("Error closing Redis connection pool: %s", exc)
            finally:
                self._client = None

    async def health_check(self) -> RedisStatus:
        """Ping Redis and measure round-trip latency in milliseconds."""
        if self._client is None:
            return RedisStatus(
                connected=False,
                host=self._settings.redis_host,
                port=self._settings.redis_port,
                latency_ms=None,
                error="Redis client is not initialized.",
            )

        start = time.perf_counter()
        try:
            pong = await self._client.ping()
            latency_ms = round((time.perf_counter() - start) * 1000.0, 3)
            if pong:
                return RedisStatus(
                    connected=True,
                    host=self._settings.redis_host,
                    port=self._settings.redis_port,
                    latency_ms=latency_ms,
                    error=None,
                )
            return RedisStatus(
                connected=False,
                host=self._settings.redis_host,
                port=self._settings.redis_port,
                latency_ms=latency_ms,
                error="Unexpected PING response from Redis.",
            )
        except (RedisError, OSError, TimeoutError) as exc:
            return RedisStatus(
                connected=False,
                host=self._settings.redis_host,
                port=self._settings.redis_port,
                latency_ms=None,
                error=str(exc),
            )
