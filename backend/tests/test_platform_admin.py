"""Platform governance: organization requests and approval, the billing switch, owner-granted
support access, Super Admin user management and platform statistics."""

import uuid
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import text, update

from app.core.config import get_settings
from app.core.email import OutgoingEmail
from app.database.session import SessionFactory, set_rls_context
from app.models import User
from tests.conftest import PASSWORD, Account, register


async def _superadmin(client: AsyncClient, email: str = "platform-admin@example.com") -> Account:
    acct = await register(client, email, "Platform Team")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=None)
        await db.execute(update(User).where(User.id == uuid.UUID(acct.user_id)).values(is_superadmin=True))
        await db.commit()
    return acct


@pytest.fixture
def approval_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "org_approval_required", True)


@pytest.mark.usefixtures("approval_on")
async def test_signup_request_is_reviewed_before_the_workspace_opens(
    client: AsyncClient, make_client: Any, outbox: list[OutgoingEmail]
) -> None:
    admin = await _superadmin(client)  # registered before approval mattered for them: Super Admins skip it
    req_client: AsyncClient = make_client()
    res = await req_client.post("/api/v1/auth/register", json={
        "email": "baker@example.com", "password": PASSWORD, "full_name": "Asha Baker",
        "organization_name": "Sunrise Bakery",
        "organization_request": {"business_type": "Bakery", "phone": "+91 98000 12345", "team_size": "2-5",
                                 "use_case": "Order updates on WhatsApp"},
    })  # fmt: skip
    assert res.status_code == 201, res.text
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    orgs = (await req_client.get("/api/v1/organizations", headers=headers)).json()
    org_id = orgs[0]["id"]
    assert orgs[0]["approval_status"] == "pending" and orgs[0]["access_block"] == "pending"
    assert any("New organization request: Sunrise Bakery" in m.subject for m in outbox)

    # While pending, only the organization's own status is readable.
    assert (await req_client.get(f"/api/v1/organizations/{org_id}", headers=headers)).status_code == 200
    blocked = await req_client.get(f"/api/v1/organizations/{org_id}/workflows", headers=headers)
    assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "org_pending"
    created = await req_client.post(f"/api/v1/organizations/{org_id}/connections", headers=headers,
                                    json={"display_name": "x", "channel_type": "simulator"})  # fmt: skip
    assert created.status_code == 403

    requests = (await client.get("/api/v1/admin/requests", headers=admin.headers)).json()
    mine = next(r for r in requests if r["id"] == org_id)
    assert (
        mine["requester"]["email"] == "baker@example.com"
        and mine["request_details"]["business_type"] == "Bakery"
    )

    approved = await client.post(f"/api/v1/admin/organizations/{org_id}/approve", headers=admin.headers,
                                 json={"billing_required": False, "plan_key": "business"})  # fmt: skip
    assert approved.status_code == 200, approved.text
    assert any(m.to == "baker@example.com" and "approved" in m.subject for m in outbox)
    assert (
        await req_client.get(f"/api/v1/organizations/{org_id}/workflows", headers=headers)
    ).status_code == 200
    usage = (await req_client.get(f"/api/v1/organizations/{org_id}/plans/usage", headers=headers)).json()
    assert usage["plan"]["key"] == "business" and usage["subscription"]["status"] == "active"
    again = await client.post(f"/api/v1/admin/organizations/{org_id}/approve", headers=admin.headers,
                              json={"billing_required": False})  # fmt: skip
    assert again.status_code == 409
    await req_client.aclose()


@pytest.mark.usefixtures("approval_on")
async def test_rejected_request_stays_closed(
    client: AsyncClient, make_client: Any, outbox: list[OutgoingEmail]
) -> None:
    admin = await _superadmin(client)
    req_client: AsyncClient = make_client()
    acct = await register(req_client, "spammy@example.com", "Spam Deals")
    rejected = await client.post(f"/api/v1/admin/organizations/{acct.org_id}/reject", headers=admin.headers,
                                 json={"reason": "Bulk promotional messaging is not allowed"})  # fmt: skip
    assert rejected.status_code == 200
    org = (await req_client.get("/api/v1/organizations", headers=acct.headers)).json()[0]
    assert org["access_block"] == "rejected" and "promotional" in org["rejection_reason"]
    res = await req_client.get(f"/api/v1/organizations/{acct.org_id}/contacts", headers=acct.headers)
    assert res.status_code == 403 and res.json()["error"]["code"] == "org_rejected"
    assert any(m.to == "spammy@example.com" and "Bulk promotional" in m.text for m in outbox)
    await req_client.aclose()


async def test_billing_switch(client: AsyncClient, make_client: Any) -> None:
    admin = await _superadmin(client)
    cust_client: AsyncClient = make_client()
    cust = await register(cust_client, "billed@example.com", "Billed Co")
    base = f"/api/v1/organizations/{cust.org_id}"
    app_url = get_settings().cors_origin_list[0] + "/billing"

    # Billing on, no trial: only the billing pages work until the organization pays.
    on = await client.post(f"/api/v1/admin/organizations/{cust.org_id}/billing", headers=admin.headers,
                           json={"billing_required": True, "plan_key": "starter"})  # fmt: skip
    assert on.status_code == 200
    org = (await cust_client.get("/api/v1/organizations", headers=cust.headers)).json()[0]
    assert org["billing_required"] is True and org["access_block"] == "billing_required"
    res = await cust_client.get(f"{base}/workflows", headers=cust.headers)
    assert res.status_code == 403 and res.json()["error"]["code"] == "billing_required"
    assert (await cust_client.get(f"{base}/plans/usage", headers=cust.headers)).status_code == 200
    assert (await cust_client.get(f"{base}/billing/invoices", headers=cust.headers)).status_code == 200

    checkout = (await cust_client.post(f"{base}/billing/checkout", headers=cust.headers,
                                       json={"plan_key": "growth", "return_url": app_url})).json()  # fmt: skip
    session = parse_qs(urlparse(checkout["checkout_url"]).query)["checkout_session"][0]
    paid = await cust_client.post(
        f"{base}/billing/checkout/confirm", headers=cust.headers, json={"session_id": session}
    )
    assert paid.status_code == 200 and paid.json()["status"] == "active"
    assert (await cust_client.get(f"{base}/workflows", headers=cust.headers)).status_code == 200
    # Saving "billing on" again must not block an organization that has already paid.
    await client.post(f"/api/v1/admin/organizations/{cust.org_id}/billing", headers=admin.headers,
                      json={"billing_required": True})  # fmt: skip
    assert (await cust_client.get(f"{base}/workflows", headers=cust.headers)).status_code == 200

    # Billing off again: the plan is granted and customers can't check out themselves.
    off = await client.post(f"/api/v1/admin/organizations/{cust.org_id}/billing", headers=admin.headers,
                            json={"billing_required": False, "plan_key": "business"})  # fmt: skip
    assert off.status_code == 200
    usage = (await cust_client.get(f"{base}/plans/usage", headers=cust.headers)).json()
    assert usage["plan"]["key"] == "business" and usage["subscription"]["status"] == "active"
    res = await cust_client.post(f"{base}/billing/checkout", headers=cust.headers,
                                 json={"plan_key": "growth", "return_url": app_url})  # fmt: skip
    assert res.status_code == 400 and res.json()["error"]["code"] == "billing_managed"

    # Billing on with a trial: open until the trial ends.
    await client.post(f"/api/v1/admin/organizations/{cust.org_id}/billing", headers=admin.headers,
                      json={"billing_required": True, "trial_days": 7})  # fmt: skip
    detail = (await client.get(f"/api/v1/admin/organizations/{cust.org_id}", headers=admin.headers)).json()
    assert detail["billing_required"] is True
    assert (await cust_client.get(f"{base}/workflows", headers=cust.headers)).status_code == 200
    await cust_client.aclose()


async def test_support_access_is_owner_granted_read_only_and_audited(
    client: AsyncClient, make_client: Any
) -> None:
    admin = await _superadmin(client)
    cust_client: AsyncClient = make_client()
    cust = await register(cust_client, "owner-support@example.com", "Support Me Ltd")
    base = f"/api/v1/organizations/{cust.org_id}"
    await cust_client.post(f"{base}/tags", headers=cust.headers, json={"name": "VIP"})

    assert (
        await client.get(f"{base}/tags", headers=admin.headers)
    ).status_code == 404  # no access by default
    grant = await cust_client.post(f"{base}/support-access", headers=cust.headers, json={"hours": 24})
    assert grant.status_code == 200 and grant.json()["support_access_until"]

    listed = (await client.get("/api/v1/organizations", headers=admin.headers)).json()
    support = next(o for o in listed if o["id"] == cust.org_id)
    assert support["support_session"] is True and support["role"]["key"] == "viewer"
    tags = await client.get(f"{base}/tags", headers=admin.headers)
    assert tags.status_code == 200 and tags.json()[0]["name"] == "VIP"
    write = await client.post(f"{base}/tags", headers=admin.headers, json={"name": "Hacked"})
    assert write.status_code == 403 and write.json()["error"]["code"] == "support_read_only"

    log = (await cust_client.get(f"{base}/support-access", headers=cust.headers)).json()
    assert [e["action"] for e in log["events"]][:2] == ["support.workspace_opened", "support.access_granted"]
    assert log["events"][0]["by"] == "Test User"

    await cust_client.post(f"{base}/support-access", headers=cust.headers, json={"hours": 0})
    assert (await client.get(f"{base}/tags", headers=admin.headers)).status_code == 404
    await cust_client.aclose()


async def test_only_owner_controls_support_access(
    client: AsyncClient, make_client: Any, outbox: list[OutgoingEmail]
) -> None:
    from tests.conftest import token_from

    owner = await register(client, "owner-only@example.com", "Owner Only")
    base = f"/api/v1/organizations/{owner.org_id}"
    await client.post(
        f"{base}/invitations", headers=owner.headers, json={"email": "adm@example.com", "role_key": "admin"}
    )
    invite = token_from(outbox[-1])
    adm_client: AsyncClient = make_client()
    adm = await register(adm_client, "adm@example.com")
    await adm_client.post("/api/v1/invitations/accept", headers=adm.headers, json={"token": invite})
    res = await adm_client.post(f"{base}/support-access", headers=adm.headers, json={"hours": 24})
    assert res.status_code == 403 and res.json()["error"]["code"] == "owner_only"
    await adm_client.aclose()


async def test_user_management(client: AsyncClient, make_client: Any, outbox: list[OutgoingEmail]) -> None:
    admin = await _superadmin(client)
    user_client: AsyncClient = make_client()
    user = await register(user_client, "managed-user@example.com", "Managed Co")

    found = (await client.get("/api/v1/admin/users?q=managed-user", headers=admin.headers)).json()
    assert found["total"] == 1 and found["items"][0]["organizations"] == 1
    detail = (await client.get(f"/api/v1/admin/users/{user.user_id}", headers=admin.headers)).json()
    assert detail["memberships"][0]["organization_name"] == "Managed Co" and detail["active_sessions"] >= 1

    assert (await client.post(f"/api/v1/admin/users/{admin.user_id}/active", headers=admin.headers,
                              json={"value": False})).status_code == 400  # fmt: skip
    disabled = await client.post(
        f"/api/v1/admin/users/{user.user_id}/active", headers=admin.headers, json={"value": False}
    )
    assert disabled.json()["is_active"] is False and disabled.json()["active_sessions"] == 0
    assert (await user_client.get("/api/v1/me", headers=user.headers)).status_code == 401
    login = await user_client.post(
        "/api/v1/auth/login", json={"email": "managed-user@example.com", "password": PASSWORD}
    )
    assert login.status_code == 401
    await client.post(
        f"/api/v1/admin/users/{user.user_id}/active", headers=admin.headers, json={"value": True}
    )
    assert (await user_client.post("/api/v1/auth/login",
                                   json={"email": "managed-user@example.com", "password": PASSWORD})).status_code == 200  # fmt: skip

    signed_out = await client.post(f"/api/v1/admin/users/{user.user_id}/sign-out", headers=admin.headers)
    assert signed_out.json()["sessions_revoked"] >= 1
    sent = await client.post(f"/api/v1/admin/users/{user.user_id}/password-reset", headers=admin.headers)
    assert sent.status_code == 200 and outbox[-1].to == "managed-user@example.com"

    promoted = await client.post(
        f"/api/v1/admin/users/{user.user_id}/superadmin", headers=admin.headers, json={"value": True}
    )
    assert promoted.json()["is_superadmin"] is True
    assert (await client.post(f"/api/v1/admin/users/{admin.user_id}/superadmin", headers=admin.headers,
                              json={"value": False})).status_code == 400  # fmt: skip
    await user_client.aclose()


async def test_platform_stats_and_permissions(client: AsyncClient, make_client: Any) -> None:
    admin = await _superadmin(client)
    stats = (await client.get("/api/v1/admin/stats?days=30", headers=admin.headers)).json()
    assert stats["organizations_total"] >= 1 and stats["users_total"] >= 1 and len(stats["daily"]) >= 30
    assert {"messages_in", "messages_out", "workflow_runs", "revenue_cents", "plans", "billing_on"} <= set(
        stats
    )

    other_client: AsyncClient = make_client()
    other = await register(other_client, "not-admin@example.com", "Plain Org")
    for path in (
        "/admin/stats",
        "/admin/requests",
        "/admin/users",
        f"/admin/organizations/{other.org_id}/channels",
    ):
        assert (await other_client.get("/api/v1" + path, headers=other.headers)).status_code == 403, path
    assert (await other_client.post(f"/api/v1/admin/organizations/{other.org_id}/billing", headers=other.headers,
                                    json={"billing_required": False})).status_code == 403  # fmt: skip
    # The statistics functions refuse anyone but a Super Admin, even through raw SQL.
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=uuid.UUID(other.user_id), org_id=None)
        with pytest.raises(Exception, match="Super Admin only"):
            await db.execute(text("SELECT platform_stats(now())"))
    await other_client.aclose()
