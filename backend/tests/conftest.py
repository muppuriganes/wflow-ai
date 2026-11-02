"""Test setup: runs against a real PostgreSQL test database (`wflow_test`, created by the
compose init script) so Row Level Security is exercised for real. Start the stack first:
    docker compose up -d
"""

import os
import re
import subprocess
import sys
import uuid
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
# Workflow engine: real Temporal dev server (docker compose), a private task queue per test session,
# and compressed time so hour-long delays and timeouts take about two seconds.
os.environ["TEMPORAL_ADDRESS"] = os.environ.get("TEMPORAL_ADDRESS") or str(
    _env.get("TEMPORAL_ADDRESS") or "127.0.0.1:57233"
)
os.environ["TEMPORAL_TASK_QUEUE"] = f"wflow-tests-{uuid.uuid4().hex[:8]}"
os.environ["WORKFLOW_TIME_SCALE"] = "0.0005"
# Organizations are approved instantly in tests unless a test turns approval on (see test_platform_admin).
os.environ["ORG_APPROVAL_REQUIRED"] = "false"
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
        await conn.execute(text("UPDATE workflows SET published_version_id = NULL"))
        await conn.execute(text("DELETE FROM channel_events"))
        await conn.execute(text("DELETE FROM customer_activities"))
        await conn.execute(text("DELETE FROM approvals"))
        await conn.execute(text("DELETE FROM schedules"))
        await conn.execute(text("DELETE FROM workflow_templates WHERE is_system = false"))
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


@pytest.fixture(scope="session")
async def temporal_worker() -> AsyncIterator[None]:
    """A Temporal worker for this test session (only tests that request it start one)."""
    import asyncio

    from temporalio.client import Client

    from app.core.config import get_settings
    from app.workers.workflow_worker import build_worker
    from app.workflow_engine import client as engine

    settings = get_settings()
    client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
    engine.set_client(client)
    worker = build_worker(client, settings.temporal_task_queue)
    task = asyncio.create_task(worker.run())
    yield
    await worker.shutdown()
    await asyncio.gather(task, return_exceptions=True)
    engine.set_client(None)


async def enable_billing(org_id: str, *, trial_days: int | None = None) -> None:
    """Turns billing on for an organization, as a Super Admin would."""
    import uuid as _uuid
    from datetime import UTC, datetime, timedelta

    from app.database.session import SessionFactory, set_rls_context
    from app.models import Organization
    from app.services.plans import get_or_create_subscription

    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=_uuid.UUID(org_id))
        org = await db.get(Organization, _uuid.UUID(org_id))
        assert org is not None
        org.billing_required = True
        sub = await get_or_create_subscription(db, org.id)
        if trial_days:
            sub.status, sub.trial_end = "trialing", datetime.now(UTC) + timedelta(days=trial_days)
        await db.commit()
