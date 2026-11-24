"""Application configuration loaded from environment variables and .env file."""

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from shared.constants import RateLimitAlgorithm

# Project root directory: adaptive-rate-limiter/
PROJECT_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE_PATH = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Typed configuration for the FastAPI rate-limiting server."""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE_PATH),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Server
    app_name: str = Field(default="Adaptive Rate Limiter API")
    app_env: str = Field(default="development")
    server_host: str = Field(default="0.0.0.0")
    server_port: int = Field(default=8000, ge=1, le=65535)
    log_level: str = Field(default="INFO")

    # Redis (localhost-only on Laptop 1)
    redis_host: str = Field(default="127.0.0.1")
    redis_port: int = Field(default=6379, ge=1, le=65535)
    redis_db: int = Field(default=0, ge=0, le=15)
    redis_password: str = Field(default="")
    redis_socket_timeout: float = Field(default=2.0, gt=0.0, le=30.0)

    # Security
    admin_api_token: str = Field(default="change-me-admin-secret-token")
    allowed_cors_origins: str = Field(default="*")

    # Rate Limiting Defaults (Stages 2 & 4)
    default_algorithm: RateLimitAlgorithm = Field(default=RateLimitAlgorithm.ADAPTIVE)
    fixed_window_limit: int = Field(default=60, ge=1)
    fixed_window_seconds: int = Field(default=60, ge=1)
    token_bucket_capacity: int = Field(default=60, ge=1)
    token_bucket_refill_rate: float = Field(default=1.0, gt=0.0)
    sliding_window_limit: int = Field(default=60, ge=1)
    sliding_window_seconds: int = Field(default=60, ge=1)

    # Adaptive Controller Parameters (Stage 4)
    adaptive_base_limit: int = Field(default=60, ge=1)
    adaptive_min_limit: int = Field(default=10, ge=1)
    adaptive_max_limit: int = Field(default=200, ge=1)
    adaptive_alpha: float = Field(default=0.50, ge=0.0, le=5.0)
    adaptive_beta: float = Field(default=0.60, ge=0.0, le=5.0)
    adaptive_gamma: float = Field(default=0.50, ge=0.0, le=5.0)

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        return value.upper()

    @property
    def cors_origins_list(self) -> list[str]:
        raw = self.allowed_cors_origins.strip()
        if not raw or raw == "*":
            return ["*"]
        return [origin.strip() for origin in raw.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return cached application settings instance."""
    return Settings()
