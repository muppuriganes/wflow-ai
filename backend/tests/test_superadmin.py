"""Tests for Super Admin Console: cross-tenant management, plan override, suspension, and health checks."""

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import update

from app.database.session import SessionFactory, set_rls_context
from app.models import User
from tests.conftest import register


@pytest.mark.asyncio
async def test_non_superadmin_forbidden(client: AsyncClient) -> None:
    # 1. Unauthenticated gets 401
    res = await client.get("/api/v1/admin/organizations")
    assert res.status_code == 401

    # 2. Regular user gets 403
    a = await register(client, email="regular_user@example.com")
    res = await client.get("/api/v1/admin/organizations", headers=a.headers)
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_superadmin_organization_management(client: AsyncClient) -> None:
    # Register an admin user and promote to superadmin
    admin_acc = await register(client, email="superadmin@example.com", org_name="Admin Org")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=None)
        await db.execute(
            update(User).where(User.id == uuid.UUID(admin_acc.user_id)).values(is_superadmin=True)
        )
        await db.commit()

    # Register tenant A and tenant B
    org_a = await register(client, email="tenant_a@example.com", org_name="Alpha Corp")
    _org_b = await register(client, email="tenant_b@example.com", org_name="Beta Logistics")

    headers = admin_acc.headers

    # 1. List organizations
    res = await client.get("/api/v1/admin/organizations", headers=headers)
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["total"] >= 3
    org_names = [item["name"] for item in data["items"]]
    assert "Alpha Corp" in org_names
    assert "Beta Logistics" in org_names

    # 2. Search organizations
    res = await client.get("/api/v1/admin/organizations?search=Alpha", headers=headers)
    assert res.status_code == 200
    search_data = res.json()
    assert search_data["total"] == 1
    assert search_data["items"][0]["name"] == "Alpha Corp"

    # 3. Get organization detail
    res = await client.get(f"/api/v1/admin/organizations/{org_a.org_id}", headers=headers)
    assert res.status_code == 200
    detail = res.json()
    assert detail["name"] == "Alpha Corp"
    assert "current_usage" in detail
    assert "members_count" in detail
    assert detail["members_count"] >= 1
    # Verify no customer message text leaks in detail
    assert "messages" not in detail

    # 4. Assign / change plan
    res = await client.post(
        f"/api/v1/admin/organizations/{org_a.org_id}/plan",
        headers=headers,
        json={"plan_key": "business", "trial_days": 30},
    )
    assert res.status_code == 200
    sub_data = res.json()
    assert sub_data["plan_key"] == "business"
    assert sub_data["status"] == "trialing"

    # 5. Suspend organization
    res = await client.post(
        f"/api/v1/admin/organizations/{org_a.org_id}/suspend",
        headers=headers,
        json={"reason": "Terms of service violation (spam reports)"},
    )
    assert res.status_code == 200
    suspend_data = res.json()
    assert suspend_data["status"] == "ok"
    assert suspend_data["org_status"] == "suspended"
    assert "spam reports" in suspend_data["suspended_reason"]

    # Verify suspension halts tenant actions in org A
    # E.g. creating invitation fails with 403 / organization_suspended
    res = await client.post(
        f"/api/v1/organizations/{org_a.org_id}/invitations",
        headers=org_a.headers,
        json={"email": "newbie@example.com", "role_key": "viewer"},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "organization_suspended"

    # 6. Restore organization
    res = await client.post(
        f"/api/v1/admin/organizations/{org_a.org_id}/restore",
        headers=headers,
    )
    assert res.status_code == 200
    restore_data = res.json()
    assert restore_data["status"] == "ok"
    assert restore_data["org_status"] == "active"

    # Verify tenant actions work again
    res = await client.post(
        f"/api/v1/organizations/{org_a.org_id}/invitations",
        headers=org_a.headers,
        json={"email": "newbie@example.com", "role_key": "viewer"},
    )
    assert res.status_code == 201, res.text


@pytest.mark.asyncio
async def test_superadmin_system_health(client: AsyncClient) -> None:
    admin_acc = await register(client, email="health_admin@example.com")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=None)
        await db.execute(
            update(User).where(User.id == uuid.UUID(admin_acc.user_id)).values(is_superadmin=True)
        )
        await db.commit()

    res = await client.get("/api/v1/admin/health", headers=admin_acc.headers)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] in ("healthy", "degraded")
    assert "database" in data["services"]
    assert data["services"]["database"]["status"] == "ok"
    assert "redis" in data["services"]
    assert data["services"]["redis"]["status"] == "ok"


async def test_superadmin_sees_only_own_org_in_normal_screens(client: AsyncClient, gateway: object) -> None:
    """The super-admin RLS policies widen what the console can read. Ordinary screens must still be
    scoped to the organization in the URL, or a super admin's own workspace would show other
    companies' data."""
    from tests.test_channels import connected
    from tests.test_workflows import chain, node

    other = await register(client, email="sa-other@example.com", org_name="Other Co")
    other_base = f"/api/v1/organizations/{other.org_id}"
    wf = (await client.post(f"{other_base}/workflows", headers=other.headers, json={"name": "Secret flow",
          "definition": chain(node("t", "trigger.manual"), node("s", "logic.stop"))})).json()  # fmt: skip
    await connected(other, gateway)  # type: ignore[arg-type]

    admin = await register(client, email="sa-scope@example.com", org_name="Platform Team")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=None)
        await db.execute(update(User).where(User.id == uuid.UUID(admin.user_id)).values(is_superadmin=True))
        await db.commit()
    base = f"/api/v1/organizations/{admin.org_id}"
    for path in (
        "/workflows",
        "/connections",
        "/members",
        "/schedules",
        "/workflow-runs",
        "/conversations?view=all",
    ):
        res = await client.get(base + path, headers=admin.headers)
        assert res.status_code == 200, (path, res.text)
        body = res.json()
        items = body["items"] if isinstance(body, dict) and "items" in body else body
        names = json.dumps(items)
        assert "Secret flow" not in names and other.org_id not in names, path
        if path == "/members":
            assert [m["email"] for m in items] == ["sa-scope@example.com"]
    assert (await client.get(f"{base}/workflows/{wf['id']}", headers=admin.headers)).status_code == 404
    mine = (await client.get("/api/v1/organizations", headers=admin.headers)).json()
    assert [o["name"] for o in mine] == ["Platform Team"]
    # The console itself does see every organization.
    console = (await client.get("/api/v1/admin/organizations", headers=admin.headers)).json()
    assert "Other Co" in json.dumps(console)
