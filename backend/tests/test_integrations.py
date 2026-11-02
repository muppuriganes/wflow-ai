"""Tests for integrations framework: SSRF protection, encrypted credentials, outgoing webhooks, and HTTP action."""

import uuid
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from httpx import AsyncClient, Response
from sqlalchemy import select

from app.core.ssrf import SSRFProtectionError, validate_url_ssrf_safe
from app.database.session import SessionFactory, set_rls_context
from app.models.commercial import IntegrationCredential, WebhookEndpoint
from app.services import credentials as creds_svc
from app.services import webhooks as webhooks_svc
from app.workflow_engine import actions
from tests.conftest import register


def test_ssrf_validator_blocks_dangerous_targets() -> None:
    dangerous = [
        "http://127.0.0.1/admin",
        "http://127.0.0.1:8000",
        "http://localhost:8100",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.1.5:8080/internal",
        "http://172.16.5.10/",
        "http://192.168.1.1/router",
        "http://[::1]/",
        "http://example.com:55432/",  # blocked Postgres port
        "http://example.com:56379/",  # blocked Redis port
        "http://example.com:8100/",  # blocked API port
        "ftp://example.com/file",  # invalid scheme
    ]
    for url in dangerous:
        with pytest.raises(SSRFProtectionError):
            validate_url_ssrf_safe(url)

    safe = [
        "https://api.stripe.com/v1/charges",
        "https://hooks.slack.com/services/T00/B00/XXXX",
        "https://example.com/webhook",
        "http://example.com/api",
    ]
    for url in safe:
        # Should not raise
        validate_url_ssrf_safe(url)


@pytest.mark.asyncio
async def test_credentials_crud_and_encryption(client: AsyncClient) -> None:
    a = await register(client, email="creds_owner@example.com")
    org_id = a.org_id
    headers = a.headers

    # 1. Create credential
    res = await client.post(
        f"/api/v1/organizations/{org_id}/credentials",
        headers=headers,
        json={"name": "GitHub Token", "type": "bearer", "secret": "ghp_secretkey123456789"},
    )
    assert res.status_code == 201, res.text
    data = res.json()
    assert data["name"] == "GitHub Token"
    assert data["type"] == "bearer"
    assert data["masked_secret"].endswith("6789")
    assert "ghp_secretkey" not in data["masked_secret"]
    cred_id = data["id"]

    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=uuid.UUID(org_id))
        # Verify secret is encrypted in database
        db_cred = await db.scalar(
            select(IntegrationCredential).where(IntegrationCredential.id == uuid.UUID(cred_id))
        )
        assert db_cred is not None
        assert "ghp_secretkey123456789" not in db_cred.encrypted_secret

        # Verify decrypted secret matches original
        cred_type, decrypted = await creds_svc.get_decrypted_secret(db, uuid.UUID(org_id), uuid.UUID(cred_id))
        assert cred_type == "bearer"
        assert decrypted == "ghp_secretkey123456789"

    # 2. List credentials
    res = await client.get(f"/api/v1/organizations/{org_id}/credentials", headers=headers)
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert items[0]["id"] == cred_id

    # 3. Tenant isolation: org B cannot see or delete org A's credential
    b = await register(client, email="creds_other@example.com")
    res = await client.get(f"/api/v1/organizations/{b.org_id}/credentials", headers=b.headers)
    assert res.status_code == 200
    assert len(res.json()) == 0

    res = await client.delete(
        f"/api/v1/organizations/{b.org_id}/credentials/{cred_id}",
        headers=b.headers,
    )
    assert res.status_code == 404

    # 4. Delete credential in org A
    res = await client.delete(
        f"/api/v1/organizations/{org_id}/credentials/{cred_id}",
        headers=headers,
    )
    assert res.status_code == 204


@pytest.mark.asyncio
async def test_webhooks_crud_and_signing(client: AsyncClient) -> None:
    a = await register(client, email="wh_owner@example.com")
    org_id = a.org_id
    headers = a.headers

    # 1. SSRF block at creation
    res = await client.post(
        f"/api/v1/organizations/{org_id}/webhooks",
        headers=headers,
        json={"name": "Internal Hook", "target_url": "http://127.0.0.1:8000/hook", "events": ["*"]},
    )
    assert res.status_code == 422

    # 2. Create valid webhook
    res = await client.post(
        f"/api/v1/organizations/{org_id}/webhooks",
        headers=headers,
        json={
            "name": "Public Hook",
            "target_url": "https://example.com/wflow-hook",
            "events": ["contact.created"],
        },
    )
    assert res.status_code == 201
    wh_data = res.json()
    assert wh_data["name"] == "Public Hook"
    assert "secret_key" in wh_data
    assert wh_data["secret_key"].startswith("whsec_")
    webhook_id = wh_data["id"]
    secret_key = wh_data["secret_key"]

    # 3. GET webhook (secret_key is NOT returned in standard GET)
    res = await client.get(f"/api/v1/organizations/{org_id}/webhooks/{webhook_id}", headers=headers)
    assert res.status_code == 200
    assert "secret_key" not in res.json()

    # 4. Ping webhook (mocking httpx inside webhooks service)
    mock_http = AsyncMock()
    mock_http.__aenter__.return_value = mock_http
    mock_http.post.return_value = Response(200, json={"received": True})

    with patch("app.services.webhooks.httpx.AsyncClient", return_value=mock_http):
        res = await client.post(
            f"/api/v1/organizations/{org_id}/webhooks/{webhook_id}/ping",
            headers=headers,
        )
        assert res.status_code == 200, res.text
        delivery_data = res.json()
        assert delivery_data["success"] is True
        assert delivery_data["response_status"] == 200

        # Verify mock received signature header
        call_kwargs = mock_http.post.call_args[1]
        req_headers = call_kwargs["headers"]
        assert "X-WFlow-Signature" in req_headers
        assert "X-WFlow-Timestamp" in req_headers

        # Verify signature validity
        ts = req_headers["X-WFlow-Timestamp"]
        raw_body = call_kwargs["content"]
        expected_sig = webhooks_svc.sign_payload(secret_key, int(ts), raw_body)
        assert req_headers["X-WFlow-Signature"] == expected_sig

    # 5. List deliveries
    res = await client.get(
        f"/api/v1/organizations/{org_id}/webhooks/{webhook_id}/deliveries",
        headers=headers,
    )
    assert res.status_code == 200
    deliveries = res.json()
    assert len(deliveries) >= 1
    assert deliveries[0]["id"] == delivery_data["id"]


@pytest.mark.asyncio
async def test_webhook_auto_disable_on_consecutive_failures(client: AsyncClient) -> None:
    a = await register(client, email="wh_fail@example.com")
    org_id = uuid.UUID(a.org_id)

    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=org_id)
        endpoint = WebhookEndpoint(
            organization_id=org_id,
            name="Failing Hook",
            target_url="https://example.com/fail",
            secret_key="whsec_test123",
            events=["*"],
            is_active=True,
            consecutive_failures=9,
        )
        db.add(endpoint)
        await db.commit()

        # 10th failure
        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.side_effect = httpx.ConnectError("Connection refused")
            delivery = await webhooks_svc.deliver_webhook(
                db,
                endpoint,
                "test.fail",
                "evt_1",
                {"hello": "world"},
            )
            assert delivery.success is False
            assert endpoint.consecutive_failures == 10
            assert endpoint.is_active is False
            assert endpoint.disabled_reason is not None
            assert "10 consecutive" in endpoint.disabled_reason


@pytest.mark.asyncio
async def test_workflow_action_http_request(client: AsyncClient) -> None:
    a = await register(client, email="wf_http@example.com")
    org_id = uuid.UUID(a.org_id)
    ctx = {"variables": {"base_url": "https://example.com"}}

    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=org_id)
        # 1. Blocks SSRF target
        with pytest.raises(SSRFProtectionError):
            await actions.http_request(
                db,
                org_id,
                ctx,
                {"url": "http://127.0.0.1:8100/secret", "method": "GET"},
            )

        # 2. Executes valid public HTTP request
        with patch("httpx.AsyncClient.request", new_callable=AsyncMock) as mock_req:
            mock_req.return_value = Response(200, text='{"status": "ok"}')
            out = await actions.http_request(
                db,
                org_id,
                ctx,
                {"url": "{{variables.base_url}}/api/status", "method": "GET"},
            )
            assert out["status_code"] == 200
            assert out["success"] is True
            assert '{"status": "ok"}' in out["body"]
            assert out["url"] == "https://example.com/api/status"
