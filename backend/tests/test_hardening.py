"""Milestone 7 tests: Prometheus metrics, brute-force lockout, security headers, and production guards."""

import pytest
from httpx import AsyncClient

from app.core.config import Settings
from app.core.rate_limit import get_redis
from tests.conftest import PASSWORD, register


@pytest.mark.asyncio
async def test_metrics_endpoint_exports_prometheus_telemetry(client: AsyncClient) -> None:
    # Generate some traffic first
    await client.get("/api/v1/health")

    res = await client.get("/metrics")
    assert res.status_code == 200
    assert "text/plain" in res.headers["content-type"]
    body = res.text
    assert "wflow_http_requests_total" in body
    assert "wflow_db_pool_size" in body
    assert "wflow_db_pool_active_connections" in body


@pytest.mark.asyncio
async def test_security_headers_present_on_all_responses(client: AsyncClient) -> None:
    res = await client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"
    assert "X-Request-ID" in res.headers


@pytest.mark.asyncio
async def test_brute_force_account_lockout(client: AsyncClient) -> None:
    email = "lockout_test@example.com"
    pwd = PASSWORD
    await register(client, email=email)

    redis = get_redis()
    await redis.delete(f"auth:fails:{email}", f"auth:lockout:{email}")

    # 4 failed attempts: return 401
    for _ in range(4):
        res = await client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword!"})
        assert res.status_code == 401
        assert res.json()["error"]["code"] == "invalid_credentials"

    # 5th failed attempt: triggers account lockout (HTTP 429)
    res5 = await client.post("/api/v1/auth/login", json={"email": email, "password": "WrongPassword!"})
    assert res5.status_code == 429
    assert res5.json()["error"]["code"] == "account_locked"

    # Even with correct password, login is blocked while locked
    res_blocked = await client.post("/api/v1/auth/login", json={"email": email, "password": pwd})
    assert res_blocked.status_code == 429
    assert res_blocked.json()["error"]["code"] == "account_locked"

    # Cleanup Redis key
    await redis.delete(f"auth:fails:{email}", f"auth:lockout:{email}")


def test_production_environment_configuration_guards() -> None:
    # 1. Production with placeholder jwt_secret must fail
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            database_admin_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            jwt_secret="change-me-to-a-random-32-byte-hex-string",
            cookie_secure=True,
            internal_api_token="a" * 32,
            simulator_enabled=False,
            workflow_time_scale=1.0,
        )

    # 2. Production with unsecure cookies must fail
    with pytest.raises(ValueError, match="COOKIE_SECURE"):
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            database_admin_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            jwt_secret="a" * 64,
            cookie_secure=False,
            internal_api_token="a" * 32,
            simulator_enabled=False,
            workflow_time_scale=1.0,
        )

    # 3. Production with simulator enabled must fail
    with pytest.raises(ValueError, match="SIMULATOR_ENABLED"):
        Settings(
            environment="production",
            database_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            database_admin_url="postgresql+asyncpg://user:pass@localhost:5432/db",
            jwt_secret="a" * 64,
            cookie_secure=True,
            internal_api_token="a" * 32,
            simulator_enabled=True,
            workflow_time_scale=1.0,
        )
