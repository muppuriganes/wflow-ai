"""Tenant isolation is enforced twice: by the API (membership checks) and by PostgreSQL RLS.
These tests prove each layer independently."""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError, ProgrammingError

from app.core.email import OutgoingEmail
from app.database.session import SessionFactory, set_rls_context
from app.models import AuditLog, Invitation, Organization, OrganizationMember
from tests.conftest import register


async def _two_tenants(client: AsyncClient, make_client: object) -> tuple:  # type: ignore[type-arg]
    a = await register(client, "alice@a.com", "Tenant A")
    other: AsyncClient = make_client()  # type: ignore[operator]
    b = await register(other, "bob@b.com", "Tenant B")
    await client.post(
        f"/api/v1/organizations/{a.org_id}/invitations",
        headers=a.headers,
        json={"email": "someone@a.com", "role_key": "viewer"},
    )
    return a, b, other


async def test_api_blocks_cross_tenant_access(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    a, b, b_client = await _two_tenants(client, make_client)
    base = f"/api/v1/organizations/{a.org_id}"
    for method, path in [
        ("GET", ""),
        ("GET", "/members"),
        ("GET", "/invitations"),
        ("GET", "/audit-logs"),
        ("GET", "/roles"),
        ("PATCH", ""),
        ("DELETE", ""),
    ]:
        res = await b_client.request(
            method, base + path, headers=b.headers, json={"name": "x"} if method == "PATCH" else None
        )
        assert res.status_code == 404, (method, path, res.status_code)
    assert [o["id"] for o in (await b_client.get("/api/v1/organizations", headers=b.headers)).json()] == [
        b.org_id
    ]
    await b_client.aclose()


async def test_rls_hides_other_tenants_rows(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    a, b, b_client = await _two_tenants(client, make_client)
    org_a, org_b = uuid.UUID(a.org_id), uuid.UUID(b.org_id)

    async with SessionFactory() as db:
        # Acting as Bob inside Tenant B: nothing of Tenant A is visible, even with explicit filters.
        await set_rls_context(db, user_id=uuid.UUID(b.user_id), org_id=org_b)
        assert await db.scalar(select(Organization).where(Organization.id == org_a)) is None
        assert (
            await db.scalars(select(OrganizationMember).where(OrganizationMember.organization_id == org_a))
        ).all() == []
        assert (await db.scalars(select(Invitation).where(Invitation.organization_id == org_a))).all() == []
        assert (await db.scalars(select(AuditLog).where(AuditLog.organization_id == org_a))).all() == []
        assert len((await db.scalars(select(Invitation))).all()) == 0  # B has none of its own
        await db.rollback()

        # No context at all: the database fails closed.
        await set_rls_context(db, user_id=None, org_id=None)
        assert (await db.scalars(select(Organization))).all() == []
        assert (await db.scalars(select(OrganizationMember))).all() == []
        await db.rollback()
    await b_client.aclose()


async def test_rls_rejects_writes_into_another_tenant(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    a, b, b_client = await _two_tenants(client, make_client)
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=uuid.UUID(b.user_id), org_id=uuid.UUID(b.org_id))
        with pytest.raises(ProgrammingError, match="row-level security"):
            await db.execute(
                text(
                    "INSERT INTO invitations (id, organization_id, email, role_id, token_hash, expires_at) "
                    "SELECT gen_random_uuid(), :org, 'evil@x.com', id, md5(random()::text), now() FROM roles LIMIT 1"
                ),
                {"org": a.org_id},
            )
        await db.rollback()

        await set_rls_context(db, user_id=uuid.UUID(b.user_id), org_id=uuid.UUID(b.org_id))
        result = await db.execute(
            text("UPDATE organizations SET name = 'pwned' WHERE id = :org"), {"org": a.org_id}
        )
        assert result.rowcount == 0  # type: ignore[attr-defined]
        await db.rollback()
    await b_client.aclose()


async def test_audit_log_is_append_only_for_app_role(
    client: AsyncClient, outbox: list[OutgoingEmail]
) -> None:
    a = await register(client, "append@a.com")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=uuid.UUID(a.user_id), org_id=uuid.UUID(a.org_id))
        with pytest.raises(DBAPIError, match="permission denied"):
            await db.execute(text("DELETE FROM audit_logs"))
        await db.rollback()
