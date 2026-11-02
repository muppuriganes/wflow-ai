import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.email import OutgoingEmail
from app.core.errors import AppError
from app.core.rate_limit import get_redis
from app.schemas.channel_events import ChannelEvent
from app.services.channels import qr_key
from app.workers.channel_events import parse_event, process_event
from tests.conftest import Account, register
from tests.fakes import FakeGateway


def event(
    acct: Account, connection_id: str, event_type: str, payload: dict[str, Any], **kw: Any
) -> ChannelEvent:
    return parse_event(
        __import__("json").dumps(
            {
                "event_id": kw.get("event_id", str(uuid.uuid4())),
                "organization_id": kw.get("org_id", acct.org_id),
                "connection_id": connection_id,
                "occurred_at": datetime.now(UTC).isoformat(),
                "event_type": event_type,
                "payload": payload,
            }
        )
    )


def received(
    acct: Account, conn_id: str, text: str, provider_id: str | None = None, **kw: Any
) -> ChannelEvent:
    return event(
        acct,
        conn_id,
        "message.received",
        {
            "provider_message_id": provider_id or f"false_{uuid.uuid4().hex}",
            "chat_id": "919800000001@c.us",
            "sender": "919800000001@c.us",
            "sender_name": "Ravi",
            "sender_phone": "919800000001",
            "message_type": "text",
            "content": text,
        },
        **kw,
    )


async def connected(acct: Account, gateway: FakeGateway, name: str = "Sales line") -> str:
    base = f"/api/v1/organizations/{acct.org_id}"
    conn = (
        await acct.client.post(f"{base}/connections", headers=acct.headers, json={"display_name": name})
    ).json()
    await acct.client.post(f"{base}/connections/{conn['id']}/initialize", headers=acct.headers)
    await process_event(
        event(acct, conn["id"], "connection.state", {"status": "CONNECTED", "phone_number": "14155550100"})
    )
    return str(conn["id"])


async def test_connection_lifecycle_with_qr(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "chan@example.com")
    base = f"/api/v1/organizations/{acct.org_id}"
    res = await client.post(f"{base}/connections", headers=acct.headers, json={"display_name": "Support"})
    assert res.status_code == 201 and res.json()["status"] == "NOT_CONNECTED"
    conn_id = res.json()["id"]

    started = await client.post(f"{base}/connections/{conn_id}/initialize", headers=acct.headers)
    assert started.json()["status"] == "INITIALIZING"
    assert gateway.calls == [("start", uuid.UUID(conn_id))]
    assert gateway.fresh_flags == [True]  # never connected: start from a clean profile

    await process_event(event(acct, conn_id, "connection.state", {"status": "QR_PENDING"}))
    await get_redis().set(qr_key(uuid.UUID(conn_id)), "data:image/png;base64,AAAA", ex=60)
    qr = (await client.get(f"{base}/connections/{conn_id}/qr", headers=acct.headers)).json()
    assert qr["status"] == "QR_PENDING" and qr["qr_data_url"].startswith("data:image/png")
    assert 0 < qr["expires_in"] <= 60

    await process_event(
        event(
            acct,
            conn_id,
            "connection.state",
            {"status": "CONNECTED", "phone_number": "14155550100", "account_name": "Acme"},
        )
    )
    conn = (await client.get(f"{base}/connections/{conn_id}", headers=acct.headers)).json()
    assert (
        conn["status"] == "CONNECTED" and conn["phone_number"] == "14155550100" and conn["last_connected_at"]
    )
    # QR is no longer served once connected.
    assert (await client.get(f"{base}/connections/{conn_id}/qr", headers=acct.headers)).json()[
        "qr_data_url"
    ] is None

    # Already connected: starting again is refused.
    again = await client.post(f"{base}/connections/{conn_id}/initialize", headers=acct.headers)
    assert again.status_code == 409

    logs = (await client.get(f"{base}/connections/{conn_id}/events", headers=acct.headers)).json()
    assert [i["summary"] for i in logs["items"]] == ["Connected", "Waiting for QR code scan"]

    # After a drop, reconnecting resumes the stored login instead of forcing a new QR scan.
    await process_event(event(acct, conn_id, "connection.state", {"status": "DISCONNECTED"}))
    resumed = await client.post(f"{base}/connections/{conn_id}/reconnect", headers=acct.headers)
    assert resumed.json()["status"] == "RECONNECTING" and gateway.fresh_flags[-1] is False


async def test_state_events_are_idempotent(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "idem@example.com")
    conn_id = await connected(acct, gateway)
    dup_id = str(uuid.uuid4())
    for _ in range(3):
        await process_event(
            event(acct, conn_id, "connection.state", {"status": "DISCONNECTED"}, event_id=dup_id)
        )
    logs = (
        await client.get(
            f"/api/v1/organizations/{acct.org_id}/connections/{conn_id}/events", headers=acct.headers
        )
    ).json()
    assert [i["summary"] for i in logs["items"]].count("Disconnected") == 1


async def test_connection_limit_and_permissions(
    client: AsyncClient, make_client: object, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "limit@example.com")
    base = f"/api/v1/organizations/{acct.org_id}/connections"
    for i in range(get_settings().max_connections_per_org):
        assert (
            await client.post(base, headers=acct.headers, json={"display_name": f"Line {i}"})
        ).status_code == 201
    over = await client.post(base, headers=acct.headers, json={"display_name": "One too many"})
    assert over.status_code == 409 and over.json()["error"]["code"] == "connection_limit"

    caps = (
        await client.get(f"/api/v1/organizations/{acct.org_id}/channel-capabilities", headers=acct.headers)
    ).json()
    assert "whatsapp_web" in caps["channel_types"]


async def test_inbound_message_creates_contact_and_conversation_once(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "inbound@example.com")
    conn_id = await connected(acct, gateway)
    ev = received(acct, conn_id, "Hi, do you deliver on Sundays?", provider_id="false_abc")
    await process_event(ev)
    await process_event(ev)  # redelivery
    await process_event(received(acct, conn_id, "Hi again", provider_id="false_abc"))  # same provider id

    base = f"/api/v1/organizations/{acct.org_id}"
    convs = (await client.get(f"{base}/conversations", headers=acct.headers)).json()
    assert convs["total"] == 1
    conv = convs["items"][0]
    assert conv["contact"]["display_name"] == "Ravi" and conv["unread_count"] == 1
    assert conv["last_message_preview"] == "Hi, do you deliver on Sundays?"

    msgs = (await client.get(f"{base}/conversations/{conv['id']}/messages", headers=acct.headers)).json()
    assert [(m["direction"], m["status"]) for m in msgs] == [("inbound", "received")]
    # Reading clears the unread counter.
    assert (await client.get(f"{base}/conversations", headers=acct.headers)).json()["items"][0][
        "unread_count"
    ] == 0


async def test_reply_is_idempotent_and_acks_move_forward(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "reply@example.com")
    conn_id = await connected(acct, gateway)
    await process_event(received(acct, conn_id, "Price for 10 units?"))
    base = f"/api/v1/organizations/{acct.org_id}"
    conv_id = (await client.get(f"{base}/conversations", headers=acct.headers)).json()["items"][0]["id"]

    body = {"text": "It's 450 per unit.", "client_message_id": "web-0001-abcd"}
    first = await client.post(f"{base}/conversations/{conv_id}/messages", headers=acct.headers, json=body)
    second = await client.post(f"{base}/conversations/{conv_id}/messages", headers=acct.headers, json=body)
    assert first.status_code == 201 and first.json()["status"] == "sent"
    assert second.json()["id"] == first.json()["id"]
    assert [c for c in gateway.calls if c[0] == "send"] == [
        ("send", ("919800000001@c.us", "It's 450 per unit.", "web-0001-abcd"))
    ]

    provider_id = "true_919800000001@c.us_web-0001-abcd"
    for status in ("read", "delivered"):  # out-of-order acks
        await process_event(
            event(acct, conn_id, "message.ack", {"provider_message_id": provider_id, "status": status})
        )
    msgs = (await client.get(f"{base}/conversations/{conv_id}/messages", headers=acct.headers)).json()
    assert msgs[-1]["status"] == "read"


async def test_governance_opt_out_and_customer_initiated(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "gov@example.com")
    conn_id = await connected(acct, gateway)
    await process_event(received(acct, conn_id, "hello"))
    base = f"/api/v1/organizations/{acct.org_id}"
    conv_id = (await client.get(f"{base}/conversations", headers=acct.headers)).json()["items"][0]["id"]

    await process_event(received(acct, conn_id, " stop "))
    blocked = await client.post(
        f"{base}/conversations/{conv_id}/messages",
        headers=acct.headers,
        json={"text": "Offer!", "client_message_id": "web-optout-1"},
    )
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "contact_opted_out"
    contact = (await client.get(f"{base}/conversations", headers=acct.headers)).json()["items"][0]["contact"]
    assert contact["consent_status"] == "opted_out"

    await process_event(received(acct, conn_id, "START"))
    ok = await client.post(
        f"{base}/conversations/{conv_id}/messages",
        headers=acct.headers,
        json={"text": "Welcome back", "client_message_id": "web-optin-1"},
    )
    assert ok.status_code == 201


async def test_send_failures_and_rate_limit(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail], monkeypatch: pytest.MonkeyPatch
) -> None:
    acct = await register(client, "fail@example.com")
    conn_id = await connected(acct, gateway)
    await process_event(received(acct, conn_id, "hello"))
    base = f"/api/v1/organizations/{acct.org_id}"
    conv_id = (await client.get(f"{base}/conversations", headers=acct.headers)).json()["items"][0]["id"]
    url = f"{base}/conversations/{conv_id}/messages"

    gateway.fail_send = AppError("Session closed", code="not_connected")
    failed = await client.post(
        url, headers=acct.headers, json={"text": "x", "client_message_id": "web-fail-0001"}
    )
    assert failed.json()["status"] == "failed" and failed.json()["error"] == "Session closed"
    gateway.fail_send = None

    monkeypatch.setattr(get_settings(), "channel_send_limit_per_minute", 2)
    codes = [
        (
            await client.post(
                url, headers=acct.headers, json={"text": "y", "client_message_id": f"web-rl-{i:04d}"}
            )
        ).status_code
        for i in range(3)
    ]
    assert codes == [201, 429, 429]  # the failed send above already used one slot

    await process_event(event(acct, conn_id, "connection.state", {"status": "DISCONNECTED"}))
    monkeypatch.setattr(get_settings(), "channel_send_limit_per_minute", 100)
    down = await client.post(
        url, headers=acct.headers, json={"text": "z", "client_message_id": "web-down-0001"}
    )
    assert down.status_code == 409 and down.json()["error"]["code"] == "connection_not_ready"


async def test_tenant_isolation_for_channels(
    client: AsyncClient, make_client: object, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    a = await register(client, "a@chan.com", "Org A")
    conn_a = await connected(a, gateway)
    await process_event(received(a, conn_a, "secret order"))
    other: AsyncClient = make_client()  # type: ignore[operator]
    b = await register(other, "b@chan.com", "Org B")

    # An event claiming org B for org A's connection is ignored.
    assert await process_event(received(b, conn_a, "spoof", org_id=b.org_id)) is False
    # B cannot see A's connection or conversations, even by id.
    assert (
        await other.get(f"/api/v1/organizations/{b.org_id}/connections/{conn_a}", headers=b.headers)
    ).status_code == 404
    assert (await other.get(f"/api/v1/organizations/{b.org_id}/conversations", headers=b.headers)).json()[
        "total"
    ] == 0
    conv_a = (await client.get(f"/api/v1/organizations/{a.org_id}/conversations", headers=a.headers)).json()[
        "items"
    ][0]["id"]
    res = await other.get(
        f"/api/v1/organizations/{b.org_id}/conversations/{conv_a}/messages", headers=b.headers
    )
    assert res.status_code == 404
    await other.aclose()


async def test_remove_requires_gateway_cleanup(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "rm@example.com")
    conn_id = await connected(acct, gateway)
    url = f"/api/v1/organizations/{acct.org_id}/connections/{conn_id}"

    gateway.unavailable = True
    res = await client.delete(url, headers=acct.headers)
    assert res.status_code == 503
    assert (await client.get(url, headers=acct.headers)).status_code == 200  # not deleted

    gateway.unavailable = False
    assert (await client.delete(url, headers=acct.headers)).status_code == 204
    assert ("remove", uuid.UUID(conn_id)) in gateway.calls
    assert (await client.get(url, headers=acct.headers)).status_code == 404


async def test_internal_restore_endpoint(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail], monkeypatch: pytest.MonkeyPatch
) -> None:
    acct = await register(client, "restore@example.com")
    conn_id = await connected(acct, gateway)
    monkeypatch.setattr(get_settings(), "internal_api_token", "t" * 40)
    assert (await client.get("/api/v1/internal/channels/restore")).status_code == 401
    assert (
        await client.get("/api/v1/internal/channels/restore", headers={"Authorization": "Bearer nope"})
    ).status_code == 401
    res = await client.get(
        "/api/v1/internal/channels/restore", headers={"Authorization": f"Bearer {'t' * 40}"}
    )
    assert res.status_code == 200
    assert [i["connection_id"] for i in res.json()] == [conn_id]
    # In-progress and logged-out connections: only the in-progress one is resumed.
    base = f"/api/v1/organizations/{acct.org_id}/connections"
    pending = (await client.post(base, headers=acct.headers, json={"display_name": "Pending"})).json()["id"]
    await client.post(f"{base}/{pending}/initialize", headers=acct.headers)
    await process_event(event(acct, pending, "connection.state", {"status": "QR_PENDING"}))
    gone = (await client.post(base, headers=acct.headers, json={"display_name": "Gone"})).json()["id"]
    await client.post(f"{base}/{gone}/initialize", headers=acct.headers)
    await client.post(f"{base}/{gone}/logout", headers=acct.headers)
    res = await client.get(
        "/api/v1/internal/channels/restore", headers={"Authorization": f"Bearer {'t' * 40}"}
    )
    assert sorted(i["connection_id"] for i in res.json()) == sorted([conn_id, pending])


async def test_simulator_only_for_simulator_connections(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    acct = await register(client, "sim@example.com")
    base = f"/api/v1/organizations/{acct.org_id}/connections"
    wa = (await client.post(base, headers=acct.headers, json={"display_name": "Real"})).json()
    sim = (
        await client.post(
            base, headers=acct.headers, json={"display_name": "Demo", "channel_type": "simulator"}
        )
    ).json()
    assert (await client.post(f"{base}/{wa['id']}/simulate/scan", headers=acct.headers)).status_code == 400
    assert (await client.post(f"{base}/{sim['id']}/simulate/scan", headers=acct.headers)).status_code == 202
    bad = await client.post(
        f"{base}/{sim['id']}/simulate/inbound",
        headers=acct.headers,
        json={"phone": "abc", "name": "X", "text": "hi"},
    )
    assert bad.status_code == 422
