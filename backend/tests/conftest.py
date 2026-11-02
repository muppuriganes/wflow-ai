"""Test setup: runs against a real PostgreSQL test database (`wflow_test`, created by the
compose init script) so Row Level Security is exercised for real. Start the stack first:
    docker compose up -d
"""

import os
import re
import subprocess
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

from dotenv import dotenv_values

_ROOT = Path(__file__).resolve().parents[2]
_env = dotenv_values(_ROOT / ".env")
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or str(_env["TEST_DATABASE_URL"])
os.environ["DATABASE_ADMIN_URL"] = os.environ.get("TEST_DATABASE_ADMIN_URL") or str(
    _env["TEST_DATABASE_ADMIN_URL"]
)
os.environ["AUTH_RATE_LIMIT"] = "100000"
# Separate Redis database so test traffic never consumes the dev server's rate-limit quota.
_redis_base = str(_env.get("REDIS_URL") or "redis://127.0.0.1:56379/0").rsplit("/", 1)[0]
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL") or f"{_redis_base}/15"

import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine  # noqa: E402

from app.cli import sync_rbac  # noqa: E402
from app.core.email import MemoryEmailSender, OutgoingEmail, set_email_sender  # noqa: E402
from app.main import app  # noqa: E402
from app.services.gateway import set_gateway  # noqa: E402
from app.services.storage import set_storage  # noqa: E402
from tests.fakes import FakeGateway, MemoryStorage  # noqa: E402

PASSWORD = "Sup3r-secret-pass"


@pytest.fixture(scope="session")
async def admin_engine() -> AsyncIterator[AsyncEngine]:
    backend_dir = Path(__file__).resolve().parents[1]
    env = {**os.environ, "MIGRATION_DATABASE_URL": os.environ["DATABASE_ADMIN_URL"]}
    for args in (["downgrade", "base"], ["upgrade", "head"]):
        subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=backend_dir,
            env=env,
            check=True,
            capture_output=True,
        )
    engine = create_async_engine(os.environ["DATABASE_ADMIN_URL"])
    await sync_rbac(engine)
    yield engine
    await engine.dispose()


@pytest.fixture(autouse=True)
async def clean_db(admin_engine: AsyncEngine) -> AsyncIterator[None]:
    yield
    async with admin_engine.begin() as conn:
        await conn.execute(text("DELETE FROM audit_logs"))
        await conn.execute(text("DELETE FROM channel_events"))
        await conn.execute(text("DELETE FROM customer_activities"))
        await conn.execute(text("DELETE FROM organizations"))
        await conn.execute(text("DELETE FROM users"))


@pytest.fixture
def outbox() -> list[OutgoingEmail]:
    sender = MemoryEmailSender()
    set_email_sender(sender)
    return sender.outbox


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def make_client() -> object:
    """Factory for extra independent clients (separate cookie jars = separate browsers)."""
    clients: list[AsyncClient] = []

    def _make() -> AsyncClient:
        c = AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
        clients.append(c)
        return c

    return _make


class Account:
    def __init__(self, client: AsyncClient, token: str, user_id: str, org_id: str, email: str) -> None:
        self.client = client
        self.token = token
        self.user_id = user_id
        self.org_id = org_id
        self.email = email

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token}"}


async def register(client: AsyncClient, email: str, org_name: str = "Acme Ltd") -> Account:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": PASSWORD, "full_name": "Test User", "organization_name": org_name},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    orgs = await client.get(
        "/api/v1/organizations", headers={"Authorization": f"Bearer {body['access_token']}"}
    )
    return Account(client, body["access_token"], body["user"]["id"], orgs.json()[0]["id"], email)


def token_from(email: OutgoingEmail) -> str:
    match = re.search(r"(?:token=|/invite/)([A-Za-z0-9_\-]+)", email.text)
    assert match, email.text
    return match.group(1)


@pytest.fixture
def gateway() -> Iterator[FakeGateway]:
    fake = FakeGateway()
    set_gateway(fake)
    yield fake
    set_gateway(None)


@pytest.fixture
def storage() -> Iterator[MemoryStorage]:
    fake = MemoryStorage()
    set_storage(fake)
    yield fake
    set_storage(None)
