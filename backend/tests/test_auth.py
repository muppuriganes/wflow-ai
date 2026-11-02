from httpx import AsyncClient

from app.core.email import OutgoingEmail
from tests.conftest import PASSWORD, register, token_from


async def test_register_creates_user_org_and_sends_verification(
    client: AsyncClient, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "Owner@Example.com", "Acme")
    me = (await client.get("/api/v1/me", headers=acct.headers)).json()
    assert me["email"] == "owner@example.com"
    assert me["email_verified_at"] is None

    orgs = (await client.get("/api/v1/organizations", headers=acct.headers)).json()
    assert len(orgs) == 1
    assert orgs[0]["name"] == "Acme"
    assert orgs[0]["role"]["key"] == "owner"
    assert "org.delete" in orgs[0]["permissions"]

    assert len(outbox) == 1 and "Verify" in outbox[0].subject
    assert "wflow_rt" in client.cookies


async def test_register_duplicate_email_conflicts(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    await register(client, "dup@example.com")
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": "DUP@example.com", "password": PASSWORD, "full_name": "X", "organization_name": "Org"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "email_taken"


async def test_weak_password_returns_validation_envelope(client: AsyncClient) -> None:
    res = await client.post(
        "/api/v1/auth/register",
        json={"email": "a@example.com", "password": "short", "full_name": "A", "organization_name": "Org"},
    )
    assert res.status_code == 422
    error = res.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["field"] == "password"
    assert error["request_id"]


async def test_login_success_and_uniform_failures(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    await register(client, "login@example.com")
    ok = await client.post("/api/v1/auth/login", json={"email": "login@example.com", "password": PASSWORD})
    assert ok.status_code == 200 and ok.json()["access_token"]

    wrong = await client.post(
        "/api/v1/auth/login", json={"email": "login@example.com", "password": "nope-12345"}
    )
    unknown = await client.post(
        "/api/v1/auth/login", json={"email": "ghost@example.com", "password": "nope-12345"}
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]


async def test_protected_endpoint_requires_token(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/me")).status_code == 401
    bad = await client.get("/api/v1/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


async def test_refresh_rotates_and_detects_reuse(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    await register(client, "rotate@example.com")
    first = client.cookies["wflow_rt"]

    res = await client.post("/api/v1/auth/refresh")
    assert res.status_code == 200
    second = client.cookies["wflow_rt"]
    assert second != first

    # Replaying the already-rotated token: rejected, and the whole session family is revoked.
    client.cookies.set("wflow_rt", first, path="/api/v1/auth")
    replay = await client.post("/api/v1/auth/refresh")
    assert replay.status_code == 401
    client.cookies.clear()
    client.cookies.set("wflow_rt", second, path="/api/v1/auth")
    after = await client.post("/api/v1/auth/refresh")
    assert after.status_code == 401
    assert after.json()["error"]["code"] == "refresh_revoked"


async def test_logout_revokes_refresh_token(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    await register(client, "logout@example.com")
    token = client.cookies["wflow_rt"]
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    client.cookies.set("wflow_rt", token, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401


async def test_email_verification(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    acct = await register(client, "verify@example.com")
    res = await client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox[0])})
    assert res.status_code == 200 and res.json()["email_verified_at"]
    again = await client.post("/api/v1/auth/verify-email", json={"token": token_from(outbox[0])})
    assert again.status_code == 400  # single use
    resend = await client.post("/api/v1/auth/resend-verification", headers=acct.headers)
    assert resend.json()["error"]["code"] == "already_verified"


async def test_password_reset_flow_revokes_sessions(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    await register(client, "reset@example.com")
    old_cookie = client.cookies["wflow_rt"]
    outbox.clear()

    res = await client.post("/api/v1/auth/forgot-password", json={"email": "reset@example.com"})
    assert res.status_code == 202
    unknown = await client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert unknown.status_code == 202 and unknown.json() == res.json()  # no account enumeration
    assert len(outbox) == 1

    new_password = "N3w-password-123"
    done = await client.post(
        "/api/v1/auth/reset-password", json={"token": token_from(outbox[0]), "password": new_password}
    )
    assert done.status_code == 200

    client.cookies.set("wflow_rt", old_cookie, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    login = await client.post(
        "/api/v1/auth/login", json={"email": "reset@example.com", "password": new_password}
    )
    assert login.status_code == 200


async def test_change_password_keeps_current_session_only(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "change@example.com")
    other: AsyncClient = make_client()  # type: ignore[operator]
    await other.post("/api/v1/auth/login", json={"email": "change@example.com", "password": PASSWORD})

    sessions = (await client.get("/api/v1/auth/sessions", headers=acct.headers)).json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1

    res = await client.post(
        "/api/v1/auth/change-password",
        headers=acct.headers,
        json={"current_password": PASSWORD, "new_password": "Another-pass-456"},
    )
    assert res.status_code == 200
    assert (await client.post("/api/v1/auth/refresh")).status_code == 200
    assert (await other.post("/api/v1/auth/refresh")).status_code == 401
    await other.aclose()


async def test_activity_log_records_logins(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    acct = await register(client, "activity@example.com")
    await client.post(
        "/api/v1/auth/login", json={"email": "activity@example.com", "password": "wrong-pass-1"}
    )
    page = (await client.get("/api/v1/me/activity", headers=acct.headers)).json()
    actions = [i["action"] for i in page["items"]]
    assert "auth.registered" in actions and "auth.login_failed" in actions
