import asyncio
import json
import uuid

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.email import OutgoingEmail
from app.core.rate_limit import get_redis
from app.services.realtime import org_channel
from app.workers.channel_events import process_event
from tests.conftest import Account, register, token_from
from tests.fakes import PNG, FakeGateway, MemoryStorage
from tests.test_channels import connected, event


async def _join(
    owner: Account, client: AsyncClient, email: str, role: str, outbox: list[OutgoingEmail]
) -> Account:
    await owner.client.post(
        f"/api/v1/organizations/{owner.org_id}/invitations",
        headers=owner.headers,
        json={"email": email, "role_key": role},
    )
    token = token_from(outbox[-1])
    member = await register(client, email, "Own Org")
    await client.post("/api/v1/invitations/accept", headers=member.headers, json={"token": token})
    member.org_id = owner.org_id
    return member


def received_from(acct: Account, conn_id: str, phone: str, name: str, text: str) -> object:
    return event(
        acct, conn_id, "message.received",
        {"provider_message_id": f"false_{uuid.uuid4().hex}", "chat_id": f"{phone}@c.us", "sender": f"{phone}@c.us",
         "sender_name": name, "sender_phone": phone, "message_type": "text", "content": text},
    )  # fmt: skip


async def test_views_counts_assignment_and_reopen(
    client: AsyncClient,
    gateway: FakeGateway,
    outbox: list[OutgoingEmail],
) -> None:
    owner = await register(client, "inbox-owner@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919800000001", "Ravi", "Need a quote"))  # type: ignore[arg-type]
    await process_event(received_from(owner, conn, "919800000002", "Meera", "Store hours?"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    convs = {
        c["contact"]["display_name"]: c
        for c in (await client.get(f"{base}/conversations", headers=owner.headers)).json()["items"]
    }
    assert set(convs) == {"Ravi", "Meera"} and all(c["status"] == "OPEN" for c in convs.values())

    ravi = convs["Ravi"]["id"]
    res = await client.post(
        f"{base}/conversations/{ravi}/assign", headers=owner.headers, json={"user_id": owner.user_id}
    )
    assert res.json()["status"] == "ASSIGNED" and res.json()["assignee"]["id"] == owner.user_id
    counts = (await client.get(f"{base}/inbox/counts", headers=owner.headers)).json()
    assert counts == {"mine": 1, "unassigned": 1, "open": 2, "resolved": 0}
    mine = (await client.get(f"{base}/conversations?view=mine", headers=owner.headers)).json()["items"]
    assert [c["id"] for c in mine] == [ravi]

    resolved = await client.post(
        f"{base}/conversations/{ravi}/status", headers=owner.headers, json={"status": "RESOLVED"}
    )
    assert resolved.json()["status"] == "RESOLVED" and resolved.json()["resolved_at"]
    # The customer writes again: reopened, and the owner keeps it.
    await process_event(received_from(owner, conn, "919800000001", "Ravi", "One more thing"))  # type: ignore[arg-type]
    again = (await client.get(f"{base}/conversations/{ravi}", headers=owner.headers)).json()
    assert (
        again["status"] == "ASSIGNED"
        and again["resolved_at"] is None
        and again["assignee"]["id"] == owner.user_id
    )

    history = (await client.get(f"{base}/conversations/{ravi}/assignments", headers=owner.headers)).json()
    assert history[0]["assignee"]["id"] == owner.user_id and history[0]["assigned_by"]["id"] == owner.user_id

    search = (await client.get(f"{base}/conversations?q=meer", headers=owner.headers)).json()["items"]
    assert [c["contact"]["display_name"] for c in search] == ["Meera"]
    by_priority = await client.post(
        f"{base}/conversations/{ravi}/priority", headers=owner.headers, json={"priority": "urgent"}
    )
    assert by_priority.json()["priority"] == "urgent"
    assert (
        len(
            (await client.get(f"{base}/conversations?priority=urgent", headers=owner.headers)).json()["items"]
        )
        == 1
    )


async def test_assignment_permissions(
    client: AsyncClient,
    make_client: object,
    gateway: FakeGateway,
    outbox: list[OutgoingEmail],
) -> None:
    owner = await register(client, "perm-owner@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919800000003", "Asha", "Hi"))  # type: ignore[arg-type]
    agent_client: AsyncClient = make_client()  # type: ignore[operator]
    agent = await _join(owner, agent_client, "agent-x@example.com", "agent_operator", outbox)
    base = f"/api/v1/organizations/{owner.org_id}"
    conv = (await agent_client.get(f"{base}/conversations", headers=agent.headers)).json()["items"][0]["id"]

    # An agent can take an unassigned conversation…
    took = await agent_client.post(
        f"{base}/conversations/{conv}/assign", headers=agent.headers, json={"user_id": agent.user_id}
    )
    assert took.status_code == 200
    # …but cannot hand it to someone else (needs inbox.assign).
    give = await agent_client.post(
        f"{base}/conversations/{conv}/assign", headers=agent.headers, json={"user_id": owner.user_id}
    )
    assert give.status_code == 403
    # Owners can reassign, but only to members who can work the inbox.
    stranger = await register(make_client(), "stranger@example.com")  # type: ignore[operator]
    bad = await client.post(
        f"{base}/conversations/{conv}/assign", headers=owner.headers, json={"user_id": stranger.user_id}
    )
    assert bad.status_code == 400 and bad.json()["error"]["code"] == "invalid_assignee"
    options = {o["id"] for o in (await client.get(f"{base}/inbox/assignees", headers=owner.headers)).json()}
    assert options == {owner.user_id, agent.user_id}

    # Notes are internal: agent can add, list shows author.
    note = await agent_client.post(
        f"{base}/conversations/{conv}/notes",
        headers=agent.headers,
        json={"body": "Called back, wants delivery Friday"},
    )
    assert note.status_code == 201
    notes = (await client.get(f"{base}/conversations/{conv}/notes", headers=owner.headers)).json()
    assert notes[0]["author"]["id"] == agent.user_id

    # Human takeover pauses automations.
    paused = await agent_client.post(
        f"{base}/conversations/{conv}/takeover", headers=agent.headers, json={"automation_paused": True}
    )
    assert paused.json()["automation_paused"] is True
    await agent_client.aclose()


async def test_viewer_is_read_only(
    client: AsyncClient,
    make_client: object,
    gateway: FakeGateway,
    outbox: list[OutgoingEmail],
) -> None:
    owner = await register(client, "ro-owner@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919800000004", "Kiran", "Hello"))  # type: ignore[arg-type]
    viewer_client: AsyncClient = make_client()  # type: ignore[operator]
    viewer = await _join(owner, viewer_client, "ro-viewer@example.com", "viewer", outbox)
    base = f"/api/v1/organizations/{owner.org_id}"
    conv = (await viewer_client.get(f"{base}/conversations", headers=viewer.headers)).json()["items"][0]["id"]
    for path, body in [
        ("notes", {"body": "x"}),
        ("status", {"status": "RESOLVED"}),
        ("messages", {"text": "hi", "client_message_id": "viewer-0001"}),
    ]:
        res = await viewer_client.post(
            f"{base}/conversations/{conv}/{path}", headers=viewer.headers, json=body
        )
        assert res.status_code == 403, path
    await viewer_client.aclose()


async def test_attachments_out_and_in(
    client: AsyncClient,
    gateway: FakeGateway,
    storage: MemoryStorage,
    outbox: list[OutgoingEmail],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner = await register(client, "files@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919800000005", "Dev", "Send the brochure"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    conv = (await client.get(f"{base}/conversations", headers=owner.headers)).json()["items"][0]["id"]

    sent = await client.post(
        f"{base}/conversations/{conv}/attachments",
        headers=owner.headers,
        files={"file": ("../../brochure.png", PNG, "application/octet-stream")},
        data={"client_message_id": "upload-0001", "caption": "Our brochure"},
    )
    assert sent.status_code == 201, sent.text
    msg = sent.json()
    assert msg["message_type"] == "image" and msg["content"] == "Our brochure" and msg["status"] == "sent"
    att = msg["attachments"][0]
    assert (
        att["file_name"] == "brochure.png" and att["content_type"] == "image/png"
    )  # type from bytes, path stripped
    key = next(iter(storage.objects))
    assert key.startswith(f"{owner.org_id}/attachments/")
    media_call = [c for c in gateway.calls if c[0] == "send_media"][0][1]
    assert media_call[1].startswith("https://internal-storage/") and media_call[3] == "image/png"

    url = (await client.get(f"{base}/attachments/{att['id']}/url", headers=owner.headers)).json()
    assert url["url"].startswith("https://files.example.com/")

    rejected = await client.post(
        f"{base}/conversations/{conv}/attachments", headers=owner.headers,
        files={"file": ("tool.exe", b"MZ\x90\x00" + b"\x00" * 100, "image/png")}, data={"client_message_id": "upload-0002"},
    )  # fmt: skip
    assert rejected.status_code == 400 and rejected.json()["error"]["code"] == "unsupported_file_type"

    # Inbound: the gateway uploads first, then references the attachment in its event.
    monkeypatch.setattr(get_settings(), "internal_api_token", "t" * 40)
    upload = await client.post(
        "/api/v1/internal/channels/media", headers={"Authorization": f"Bearer {'t' * 40}"},
        data={"organization_id": owner.org_id, "connection_id": conn}, files={"file": ("photo.png", PNG, "image/png")},
    )  # fmt: skip
    assert upload.status_code == 200, upload.text
    attachment_id = upload.json()["attachment_id"]
    ev = event(owner, conn, "message.received", {
        "provider_message_id": "false_photo_1", "chat_id": "919800000005@c.us", "sender": "919800000005@c.us",
        "message_type": "image", "content": "receipt", "attachment": {"attachment_id": attachment_id},
    })  # fmt: skip
    await process_event(ev)
    messages = (await client.get(f"{base}/conversations/{conv}/messages", headers=owner.headers)).json()
    assert messages[-1]["attachments"][0]["id"] == attachment_id

    # The internal upload endpoint refuses a connection from another organization.
    other = await register(client, "files-other@example.com", "Other Org")
    wrong = await client.post(
        "/api/v1/internal/channels/media", headers={"Authorization": f"Bearer {'t' * 40}"},
        data={"organization_id": other.org_id, "connection_id": conn}, files={"file": ("p.png", PNG, "image/png")},
    )  # fmt: skip
    assert wrong.status_code == 404


async def test_changes_are_published_for_live_updates(
    client: AsyncClient,
    gateway: FakeGateway,
    outbox: list[OutgoingEmail],
) -> None:
    owner = await register(client, "live@example.com")
    conn = await connected(owner, gateway)
    pubsub = get_redis().pubsub()
    await pubsub.subscribe(org_channel(owner.org_id))
    await process_event(received_from(owner, conn, "919800000006", "Live", "ping"))  # type: ignore[arg-type]
    seen = []
    for _ in range(20):
        msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=0.2)
        if msg:
            seen.append(json.loads(msg["data"]))
        if any(m["type"] == "message.created" for m in seen):
            break
        await asyncio.sleep(0.05)
    await pubsub.unsubscribe()
    await pubsub.aclose()
    assert any(m["type"] == "message.created" for m in seen)
    assert all("content" not in m for m in seen)  # ids only, never message text
