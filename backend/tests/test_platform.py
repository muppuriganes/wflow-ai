import uuid

import pytest
from httpx import AsyncClient

from app.core.errors import RateLimitedError
from app.core.rate_limit import enforce_rate_limit


async def test_health_endpoints(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/health")).json() == {"status": "ok"}
    ready = await client.get("/api/v1/health/ready")
    assert ready.status_code == 200
    assert ready.json()["checks"] == {"database": "ok", "redis": "ok"}


async def test_request_id_and_security_headers(client: AsyncClient) -> None:
    res = await client.get("/api/v1/health", headers={"X-Request-ID": "trace-12345678"})
    assert res.headers["x-request-id"] == "trace-12345678"
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


async def test_rate_limit_blocks_after_limit() -> None:
    key = uuid.uuid4().hex
    for _ in range(3):
        await enforce_rate_limit("test", key, limit=3, window_seconds=30)
    with pytest.raises(RateLimitedError):
        await enforce_rate_limit("test", key, limit=3, window_seconds=30)


async def test_unknown_route_uses_error_envelope(client: AsyncClient) -> None:
    res = await client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "http_error"
