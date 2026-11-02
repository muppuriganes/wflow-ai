"""Integrations: SSRF protection, encrypted credentials, outgoing webhooks and the HTTP request step.

Webhook and HTTP-step tests talk to a real HTTP receiver on 127.0.0.1 (private addresses are allowed
only for these tests) and run deliveries through Temporal, exactly as in production.
"""

import asyncio
import hashlib
import hmac
import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.ssrf import SSRFProtectionError, check_ip, check_url
from app.database.session import SessionFactory, set_rls_context
from app.models.commercial import IntegrationCredential
from app.services import credentials as creds_svc
from app.workers.channel_events import process_event
from tests.conftest import register
from tests.fakes import FakeGateway
from tests.test_channels import connected
from tests.test_inbox import received_from
from tests.test_workflows import _publish, _wait, chain, node


@dataclass
class Receiver:
    """A tiny HTTP server that records requests and answers with queued status codes (then 200)."""

    port: int = 0
    requests: list[dict[str, Any]] = field(default_factory=list)
    statuses: list[int] = field(default_factory=list)

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.port}/hook"

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        head = await reader.readuntil(b"\r\n\r\n")
        lines = head.decode().split("\r\n")
        method, path, _ = lines[0].split(" ", 2)
        headers = {k.lower(): v.strip() for k, _, v in (ln.partition(":") for ln in lines[1:] if ln)}
        body = await reader.readexactly(int(headers.get("content-length", "0")))
        self.requests.append({"method": method, "path": path, "headers": headers, "body": body.decode()})
        status = self.statuses.pop(0) if self.statuses else 200
        writer.write(f"HTTP/1.1 {status} X\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok".encode())
        await writer.drain()
        writer.close()

    async def wait_for(self, count: int, timeout: float = 20) -> list[dict[str, Any]]:
        deadline = asyncio.get_running_loop().time() + timeout
        while len(self.requests) < count:
            if asyncio.get_running_loop().time() > deadline:
                raise AssertionError(f"expected {count} requests, got {self.requests}")
            await asyncio.sleep(0.1)
        return self.requests


@pytest.fixture
async def receiver(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[Receiver]:
    monkeypatch.setattr(get_settings(), "outbound_allow_private_networks", True)
    rec = Receiver()
    server = await asyncio.start_server(rec.handle, "127.0.0.1", 0)
    rec.port = server.sockets[0].getsockname()[1]
    yield rec
    server.close()
    await server.wait_closed()


def test_ssrf_blocks_internal_addresses() -> None:
    blocked = ["127.0.0.1", "::1", "::ffff:127.0.0.1", "169.254.169.254", "10.1.2.3", "172.16.0.1", "192.168.1.1",
               "100.64.0.1", "fc00::1", "fe80::1", "0.0.0.0", "224.0.0.1", "2002:7f00:1::1"]  # fmt: skip
    for ip in blocked:
        with pytest.raises(SSRFProtectionError):
            check_ip(ip)
    for ip in ("8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"):
        check_ip(ip)


async def test_ssrf_url_checks() -> None:
    for url in ("http://localhost:3000", "http://127.0.0.1/admin", "http://[::1]/", "http://169.254.169.254/latest",
                "http://example.com:55432/", "http://example.com:8100/", "ftp://example.com/f",
                "http://user:pass@example.com/"):  # fmt: skip
        with pytest.raises(SSRFProtectionError):
            await check_url(url)


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


async def _endpoint(
    client: AsyncClient, base: str, headers: dict[str, str], url: str, events: list[str]
) -> dict[str, Any]:
    res = await client.post(
        f"{base}/webhooks", headers=headers, json={"name": "Receiver", "target_url": url, "events": events}
    )
    assert res.status_code == 201, res.text
    return dict(res.json())


def _verify(req: dict[str, Any], secret: str) -> dict[str, Any]:
    ts = req["headers"]["x-wflow-timestamp"]
    expected = (
        "sha256=" + hmac.new(secret.encode(), f"{ts}.{req['body']}".encode(), hashlib.sha256).hexdigest()
    )
    assert hmac.compare_digest(req["headers"]["x-wflow-signature"], expected), "bad signature"
    return dict(json.loads(req["body"]))


@pytest.mark.usefixtures("temporal_worker")
async def test_webhooks_fire_for_real_events_and_retry(
    client: AsyncClient, gateway: FakeGateway, receiver: Receiver
) -> None:
    a = await register(client, "hooks-e2e@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    bad = await client.post(f"{base}/webhooks", headers=a.headers,
                            json={"name": "x", "target_url": receiver.url, "events": ["made.up"]})  # fmt: skip
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_events"
    blocked = await client.post(f"{base}/webhooks", headers=a.headers,
                                json={"name": "x", "target_url": "http://169.254.169.254/", "events": ["message.received"]})  # fmt: skip
    assert blocked.status_code == 422

    hook = await _endpoint(client, base, a.headers, receiver.url,
                           ["message.received", "contact.created", "lead.stage_changed"])  # fmt: skip
    receiver.statuses = [500]  # the first delivery fails and is retried
    conn = await connected(a, gateway)
    await process_event(received_from(a, conn, "919800011122", "Kavya", "Do you deliver?"))  # type: ignore[arg-type]

    got = await receiver.wait_for(3)  # contact.created + message.received, one of them retried after the 500
    events = [_verify(r, hook["secret_key"]) for r in got]
    by_type: dict[str, list[dict[str, Any]]] = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(e)
    assert sorted(by_type) == ["contact.created", "message.received"]
    assert by_type["contact.created"][0]["data"]["source"] == "whatsapp"
    assert by_type["message.received"][0]["data"]["text"] == "Do you deliver?"
    retried = [evts for evts in by_type.values() if len(evts) == 2]
    assert len(retried) == 1 and retried[0][0]["id"] == retried[0][1]["id"]  # the same event, delivered again

    log = (await client.get(f"{base}/webhooks/{hook['id']}/deliveries", headers=a.headers)).json()
    attempts = sorted((d["event_type"], d["attempt"], d["success"]) for d in log)
    retried_type = retried[0][0]["type"]
    assert (retried_type, 1, False) in attempts and (retried_type, 2, True) in attempts

    # A lead moving stage is delivered too; unsubscribed events are not.
    contact_id = by_type["contact.created"][0]["data"]["contact_id"]
    lead = (
        await client.post(
            f"{base}/leads", headers=a.headers, json={"contact_id": contact_id, "title": "Bulk"}
        )
    ).json()
    await client.patch(f"{base}/leads/{lead['id']}", headers=a.headers, json={"stage": "QUALIFIED"})
    got = await receiver.wait_for(4)
    stage = _verify(got[3], hook["secret_key"])
    assert (
        stage["type"] == "lead.stage_changed"
        and stage["data"]["from"] == "NEW"
        and stage["data"]["to"] == "QUALIFIED"
    )
    await asyncio.sleep(1)
    assert len(receiver.requests) == 4


@pytest.mark.usefixtures("temporal_worker")
async def test_failing_endpoint_is_auto_disabled(client: AsyncClient, receiver: Receiver) -> None:
    a = await register(client, "hooks-disable@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    hook = await _endpoint(client, base, a.headers, receiver.url, ["contact.created"])
    receiver.statuses = [503] * 20
    for i in range(2):
        await client.post(f"{base}/contacts", headers=a.headers,
                          json={"display_name": f"C{i}", "phone_number": f"+9198000000{i}0"})  # fmt: skip
    await receiver.wait_for(10)
    await asyncio.sleep(1)
    endpoint = (await client.get(f"{base}/webhooks/{hook['id']}", headers=a.headers)).json()
    assert endpoint["is_active"] is False and "10 consecutive" in endpoint["disabled_reason"]
    seen = len(receiver.requests)
    await client.post(
        f"{base}/contacts", headers=a.headers, json={"display_name": "Later", "phone_number": "+919800000999"}
    )
    await asyncio.sleep(1)
    assert len(receiver.requests) == seen  # disabled endpoints get nothing


@pytest.mark.usefixtures("temporal_worker")
async def test_http_request_step_uses_credentials_and_blocks_internal_targets(
    client: AsyncClient, receiver: Receiver
) -> None:
    a = await register(client, "http-step@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    cred = (await client.post(f"{base}/credentials", headers=a.headers,
                              json={"name": "CRM", "type": "bearer", "secret": "tok_live_123"})).json()  # fmt: skip
    wf = await _publish(a, "Push to CRM", chain(
        node("t", "trigger.manual"),
        node("h", "action.http_request", {"url": receiver.url + "?src=wflow", "method": "POST",
                                          "headers": '{"X-Org": "{{org.name}}"}', "body": '{"hello": "world"}',
                                          "credential_id": cred["id"]}),
    ))  # fmt: skip
    run_id = (await client.post(f"{base}/workflows/{wf}/execute", headers=a.headers, json={})).json()["id"]
    run = await _wait(a, run_id, {"COMPLETED", "FAILED"})
    assert run["status"] == "COMPLETED", run
    req = (await receiver.wait_for(1))[0]
    assert req["headers"]["authorization"] == "Bearer tok_live_123"  # was "Bearer ('bearer', '...')"
    assert req["headers"]["x-org"] == "Acme Ltd" and req["body"] == '{"hello": "world"}'
    step = next(n for n in run["nodes"] if n["node_id"] == "h")
    assert step["output"]["status_code"] == 200 and "tok_live_123" not in json.dumps(step)

    # Internal targets fail at once (no retries) with a clear reason.
    get_settings().outbound_allow_private_networks = False
    wf2 = await _publish(a, "Metadata probe", chain(
        node("t", "trigger.manual"), node("h", "action.http_request", {"url": "http://169.254.169.254/latest", "method": "GET"}),
    ))  # fmt: skip
    run2_id = (await client.post(f"{base}/workflows/{wf2}/execute", headers=a.headers, json={})).json()["id"]
    run2 = await _wait(a, run2_id, {"COMPLETED", "FAILED"})
    failed = next(n for n in run2["nodes"] if n["node_id"] == "h")
    assert run2["status"] == "FAILED" and failed["attempt"] == 1 and "internal" in run2["error"]
