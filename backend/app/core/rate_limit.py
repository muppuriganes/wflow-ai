"""Fixed-window rate limiting backed by Redis."""

from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.errors import RateLimitedError
from app.core.logging import get_logger

log = get_logger(__name__)

_redis: Redis | None = None


def get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
    return _redis


async def close_redis() -> None:
    global _redis
    if _redis is not None:
        await _redis.aclose()
        _redis = None


async def enforce_rate_limit(bucket: str, key: str, *, limit: int, window_seconds: int) -> None:
    redis_key = f"rl:{bucket}:{key}"
    try:
        pipe = get_redis().pipeline()
        pipe.incr(redis_key)
        pipe.expire(redis_key, window_seconds, nx=True)
        count, _ = await pipe.execute()
    except RedisError:
        # Availability over strictness: a Redis outage must not lock every user out.
        # It is logged loudly so the outage is visible.
        log.error("rate_limit_unavailable", bucket=bucket)
        return
    if int(count) > limit:
        raise RateLimitedError(
            "Too many requests. Please wait and try again.", details={"retry_after": window_seconds}
        )
