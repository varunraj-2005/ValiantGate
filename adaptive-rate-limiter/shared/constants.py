"""Shared constants, enumerations, and header names."""

from enum import Enum


class RateLimitAlgorithm(str, Enum):
    """Supported rate-limiting algorithms."""

    FIXED_WINDOW = "fixed_window"
    TOKEN_BUCKET = "token_bucket"
    SLIDING_WINDOW = "sliding_window"
    ADAPTIVE = "adaptive"


class UserCategory(str, Enum):
    """User tiers with priority weights."""

    BASIC = "basic"
    STANDARD = "standard"
    PREMIUM = "premium"


USER_PRIORITY_WEIGHTS: dict[UserCategory, int] = {
    UserCategory.BASIC: 1,
    UserCategory.STANDARD: 2,
    UserCategory.PREMIUM: 3,
}


class TrafficState(str, Enum):
    """Traffic intensity indicator states."""

    NORMAL = "GREEN"
    HIGH = "ORANGE"
    CRITICAL = "RED"


class HeaderNames:
    """Standard HTTP headers used across the client and backend."""

    API_KEY = "X-API-Key"
    USER_CATEGORY = "X-User-Category"
    ADMIN_TOKEN = "X-Admin-Token"
    ALGORITHM = "X-RateLimit-Algorithm"
    REQUEST_ID = "X-Request-ID"
