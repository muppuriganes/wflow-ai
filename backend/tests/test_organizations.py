from httpx import AsyncClient

from app.core.email import OutgoingEmail
from tests.conftest import Account, register, token_from


async def _invite(owner: Account, email: str, role: str) -> dict:  # type: ignore[type-arg]
    res = await owner.client.post(
        f"/api/v1/organizations/{owner.org_id}/invitations",
        headers=owner.headers,
        json={"email": email, "role_key": role},
    )
    assert res.status_code == 201, res.text
    return res.json()  # type: ignore[no-any-return]


async def _join(
    owner: Account, invitee_client: AsyncClient, email: str, role: str, outbox: list[OutgoingEmail]
) -> Account:
    await _invite(owner, email, role)
    token = token_from(outbox[-1])
    invitee = await register(invitee_client, email, "Invitee Own Org")
    res = await invitee_client.post(
        "/api/v1/invitations/accept", headers=invitee.headers, json={"token": token}
    )
    assert res.status_code == 200, res.text
    invitee.org_id = owner.org_id
    return invitee


async def test_create_and_switch_organizations(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    acct = await register(client, "multi@example.com", "First")
    res = await client.post(
        "/api/v1/organizations", headers=acct.headers, json={"name": "Second", "timezone": "Asia/Kolkata"}
    )
    assert res.status_code == 201
    assert res.json()["role"]["key"] == "owner" and res.json()["timezone"] == "Asia/Kolkata"
    names = [o["name"] for o in (await client.get("/api/v1/organizations", headers=acct.headers)).json()]
    assert names == ["First", "Second"]


async def test_invalid_timezone_rejected(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    acct = await register(client, "tz@example.com")
    res = await client.patch(
        f"/api/v1/organizations/{acct.org_id}", headers=acct.headers, json={"timezone": "Mars/Base"}
    )
    assert res.status_code == 422


async def test_invitation_flow_and_viewer_permissions(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "owner@example.com", "Acme")
    viewer_client: AsyncClient = make_client()  # type: ignore[operator]
    await _invite(owner, "viewer@example.com", "viewer")
    token = token_from(outbox[-1])

    preview = await viewer_client.post("/api/v1/invitations/preview", json={"token": token})
    assert preview.json() == {
        "organization_name": "Acme",
        "email": "viewer@example.com",
        "role_name": "Viewer",
        "status": "pending",
    }

    viewer = await register(viewer_client, "viewer@example.com", "Viewer Co")
    accepted = await viewer_client.post(
        "/api/v1/invitations/accept", headers=viewer.headers, json={"token": token}
    )
    assert accepted.status_code == 200 and accepted.json()["id"] == owner.org_id

    members = (
        await client.get(f"/api/v1/organizations/{owner.org_id}/members", headers=owner.headers)
    ).json()
    assert {m["email"]: m["role"]["key"] for m in members} == {
        "owner@example.com": "owner",
        "viewer@example.com": "viewer",
    }

    # Viewer can read but not change anything.
    org_url = f"/api/v1/organizations/{owner.org_id}"
    assert (await viewer_client.get(org_url, headers=viewer.headers)).status_code == 200
    denied = await viewer_client.patch(org_url, headers=viewer.headers, json={"name": "Hacked"})
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "missing_permission"
    invite = await viewer_client.post(
        f"{org_url}/invitations",
        headers=viewer.headers,
        json={"email": "x@example.com", "role_key": "viewer"},
    )
    assert invite.status_code == 403
    assert (await viewer_client.get(f"{org_url}/audit-logs", headers=viewer.headers)).status_code == 403
    await viewer_client.aclose()


async def test_invitation_email_must_match(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "o2@example.com")
    await _invite(owner, "intended@example.com", "viewer")
    token = token_from(outbox[-1])
    other_client: AsyncClient = make_client()  # type: ignore[operator]
    other = await register(other_client, "intruder@example.com")
    res = await other_client.post("/api/v1/invitations/accept", headers=other.headers, json={"token": token})
    assert res.status_code == 403 and res.json()["error"]["code"] == "invitation_email_mismatch"
    await other_client.aclose()


async def test_revoked_invitation_cannot_be_used(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "o3@example.com")
    inv = await _invite(owner, "late@example.com", "viewer")
    token = token_from(outbox[-1])
    res = await client.delete(
        f"/api/v1/organizations/{owner.org_id}/invitations/{inv['id']}", headers=owner.headers
    )
    assert res.status_code == 204
    late_client: AsyncClient = make_client()  # type: ignore[operator]
    late = await register(late_client, "late@example.com")
    accept = await late_client.post("/api/v1/invitations/accept", headers=late.headers, json={"token": token})
    assert accept.status_code == 400 and accept.json()["error"]["code"] == "invitation_unusable"
    await late_client.aclose()


async def test_role_rank_and_last_owner_rules(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "boss@example.com")
    admin_client: AsyncClient = make_client()  # type: ignore[operator]
    admin = await _join(owner, admin_client, "admin@example.com", "admin", outbox)
    base = f"/api/v1/organizations/{owner.org_id}"
    members = {m["email"]: m for m in (await client.get(f"{base}/members", headers=owner.headers)).json()}

    # Admin cannot invite an owner or touch the owner.
    up = await admin_client.post(
        f"{base}/invitations", headers=admin.headers, json={"email": "z@example.com", "role_key": "owner"}
    )
    assert up.status_code == 403 and up.json()["error"]["code"] == "role_rank"
    demote = await admin_client.patch(
        f"{base}/members/{members['boss@example.com']['id']}",
        headers=admin.headers,
        json={"role_key": "viewer"},
    )
    assert demote.status_code == 403

    # The only owner cannot leave or be demoted.
    leave = await client.delete(f"{base}/members/{members['boss@example.com']['id']}", headers=owner.headers)
    assert leave.status_code == 409 and leave.json()["error"]["code"] == "last_owner"
    self_change = await client.patch(
        f"{base}/members/{members['boss@example.com']['id']}",
        headers=owner.headers,
        json={"role_key": "admin"},
    )
    assert self_change.status_code == 403

    # Owner can promote the admin to owner, after which the original owner may leave.
    promote = await client.patch(
        f"{base}/members/{members['admin@example.com']['id']}",
        headers=owner.headers,
        json={"role_key": "owner"},
    )
    assert promote.status_code == 200 and promote.json()["role"]["key"] == "owner"
    assert (
        await client.delete(f"{base}/members/{members['boss@example.com']['id']}", headers=owner.headers)
    ).status_code == 204
    assert (await client.get(base, headers=owner.headers)).status_code == 404
    await admin_client.aclose()


async def test_audit_log_and_roles(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    owner = await register(client, "audit@example.com", "Audit Co")
    base = f"/api/v1/organizations/{owner.org_id}"
    await client.patch(base, headers=owner.headers, json={"name": "Audit Co Renamed"})
    logs = (await client.get(f"{base}/audit-logs", headers=owner.headers)).json()
    actions = [i["action"] for i in logs["items"]]
    assert actions[:2] == ["organization.updated", "organization.created"]
    assert logs["items"][0]["actor_email"] == "audit@example.com"

    roles = (await client.get(f"{base}/roles", headers=owner.headers)).json()
    assert [r["key"] for r in roles] == [
        "owner",
        "admin",
        "manager",
        "automation_developer",
        "agent_operator",
        "viewer",
    ]
    perms = (await client.get("/api/v1/permissions", headers=owner.headers)).json()
    assert {"code", "category", "description"} <= set(perms[0])


async def test_soft_delete_organization(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    owner = await register(client, "del@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    assert (await client.delete(base, headers=owner.headers)).status_code == 204
    assert (await client.get(base, headers=owner.headers)).status_code == 404
    assert (await client.get("/api/v1/organizations", headers=owner.headers)).json() == []


async def test_register_via_invitation_without_own_org(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "inviter@example.com")
    await _invite(owner, "joiner@example.com", "agent_operator")
    token = token_from(outbox[-1])
    joiner_client: AsyncClient = make_client()  # type: ignore[operator]
    res = await joiner_client.post(
        "/api/v1/auth/register",
        json={"email": "joiner@example.com", "password": "Sup3r-secret-pass", "full_name": "Joiner"},
    )
    assert res.status_code == 201
    headers = {"Authorization": f"Bearer {res.json()['access_token']}"}
    assert (await joiner_client.get("/api/v1/organizations", headers=headers)).json() == []
    await joiner_client.post("/api/v1/invitations/accept", headers=headers, json={"token": token})
    orgs = (await joiner_client.get("/api/v1/organizations", headers=headers)).json()
    assert [(o["id"], o["role"]["key"]) for o in orgs] == [(owner.org_id, "agent_operator")]
    me = (await joiner_client.get("/api/v1/me", headers=headers)).json()
    assert me["email_verified_at"] is not None  # accepting the emailed link proves the address
    await joiner_client.aclose()
