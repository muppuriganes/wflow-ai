from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.core.email import OutgoingEmail
from app.workers.channel_events import process_event
from tests.conftest import register, token_from
from tests.fakes import FakeGateway
from tests.test_channels import connected
from tests.test_inbox import received_from


async def test_contacts_phone_normalization_dedupe_and_merge(
    client: AsyncClient,
    gateway: FakeGateway,
    outbox: list[OutgoingEmail],
) -> None:
    owner = await register(client, "crm@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    res = await client.post(
        f"{base}/contacts", headers=owner.headers,
        json={"display_name": "Priya Nair", "phone_number": "+91 98000-00011", "email": "priya@example.com", "company": "Nair Textiles"},
    )  # fmt: skip
    assert res.status_code == 201, res.text
    contact = res.json()
    assert contact["phone_number"] == "919800000011" and contact["consent_status"] == "unknown"

    dup = await client.post(
        f"{base}/contacts",
        headers=owner.headers,
        json={"display_name": "Dup", "phone_number": "919800000011"},
    )
    assert dup.status_code == 409 and dup.json()["error"]["details"]["contact_id"] == contact["id"]

    # Messages from that number land on the same contact, which becomes "engaged".
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919800000011", "Priya", "Hi, saw your catalogue"))  # type: ignore[arg-type]
    listed = (await client.get(f"{base}/contacts?q=nair", headers=owner.headers)).json()
    assert listed["total"] == 1 and listed["items"][0]["consent_status"] == "engaged"
    detail = (await client.get(f"{base}/contacts/{contact['id']}", headers=owner.headers)).json()
    assert len(detail["conversations"]) == 1

    # Manual opt-out is recorded and shown on the timeline.
    await client.post(
        f"{base}/contacts/{contact['id']}/consent", headers=owner.headers, json={"opted_out": True}
    )
    timeline = (await client.get(f"{base}/contacts/{contact['id']}/activities", headers=owner.headers)).json()
    assert [a["activity_type"] for a in timeline][:2] == ["consent.changed", "contact.created"]

    # Tags
    tag = (
        await client.post(f"{base}/tags", headers=owner.headers, json={"name": "VIP", "color": "primary"})
    ).json()
    dup_tag = await client.post(f"{base}/tags", headers=owner.headers, json={"name": "vip"})
    assert dup_tag.status_code == 409
    tagged = await client.put(
        f"{base}/contacts/{contact['id']}/tags", headers=owner.headers, json=[tag["id"]]
    )
    assert [t["name"] for t in tagged.json()] == ["VIP"]
    assert (await client.get(f"{base}/contacts?tag_id={tag['id']}", headers=owner.headers)).json()[
        "total"
    ] == 1


async def test_custom_fields_validation(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    owner = await register(client, "fields@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    for body in (
        {"entity": "contact", "key": "city", "label": "City", "field_type": "text", "required": True},
        {
            "entity": "contact",
            "key": "segment",
            "label": "Segment",
            "field_type": "select",
            "options": ["Retail", "Wholesale"],
        },
        {"entity": "contact", "key": "budget", "label": "Budget", "field_type": "number"},
    ):
        assert (
            await client.post(f"{base}/custom-fields", headers=owner.headers, json=body)
        ).status_code == 201
    no_options = await client.post(f"{base}/custom-fields", headers=owner.headers,
                                   json={"entity": "lead", "key": "x", "label": "X", "field_type": "select"})  # fmt: skip
    assert no_options.json()["error"]["code"] == "options_required"

    async def make(fields: dict) -> object:  # type: ignore[type-arg]
        return await client.post(
            f"{base}/contacts", headers=owner.headers, json={"display_name": "C", "custom_fields": fields}
        )

    assert (await make({"segment": "Retail"})).json()["error"]["code"] == "custom_field_required"  # type: ignore[attr-defined]
    assert (await make({"city": "Pune", "segment": "Enterprise"})).json()["error"][
        "code"
    ] == "invalid_custom_field"  # type: ignore[attr-defined]
    assert (await make({"city": "Pune", "unknown": 1})).json()["error"]["code"] == "invalid_custom_field"  # type: ignore[attr-defined]
    ok = await make({"city": "Pune", "segment": "Wholesale", "budget": "25000.50"})
    assert ok.status_code == 201  # type: ignore[attr-defined]
    assert ok.json()["custom_fields"] == {"city": "Pune", "segment": "Wholesale", "budget": 25000.5}  # type: ignore[attr-defined]


async def test_leads_pipeline_and_tasks(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "pipeline@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    contact = (
        await client.post(f"{base}/contacts", headers=owner.headers, json={"display_name": "Arjun"})
    ).json()
    lead = await client.post(
        f"{base}/leads", headers=owner.headers,
        json={"contact_id": contact["id"], "title": "500 school uniforms", "value_amount": "150000", "source": "whatsapp",
              "owner_user_id": owner.user_id, "score": 70},
    )  # fmt: skip
    assert lead.status_code == 201, lead.text
    lead_id = lead.json()["id"]

    moved = await client.patch(f"{base}/leads/{lead_id}", headers=owner.headers, json={"stage": "PROPOSAL"})
    assert moved.json()["stage"] == "PROPOSAL" and moved.json()["closed_at"] is None
    won = await client.patch(f"{base}/leads/{lead_id}", headers=owner.headers, json={"stage": "CONVERTED"})
    assert won.json()["closed_at"] is not None

    board = (await client.get(f"{base}/leads", headers=owner.headers)).json()
    converted = next(s for s in board["stages"] if s["stage"] == "CONVERTED")
    assert converted["count"] == 1 and float(converted["total_value"]) == 150000.0

    stranger = await register(make_client(), "not-member@example.com")  # type: ignore[operator]
    bad_owner = await client.patch(
        f"{base}/leads/{lead_id}", headers=owner.headers, json={"owner_user_id": stranger.user_id}
    )
    assert bad_owner.json()["error"]["code"] == "invalid_user"

    # Tasks: linking a lead links its contact; due filters respect the viewer's timezone.
    now = datetime.now(UTC)
    overdue = await client.post(f"{base}/tasks", headers=owner.headers,
                                json={"title": "Send invoice", "lead_id": lead_id, "due_at": (now - timedelta(hours=2)).isoformat()})  # fmt: skip
    assert overdue.status_code == 201 and overdue.json()["contact"]["id"] == contact["id"]
    await client.post(f"{base}/tasks", headers=owner.headers,
                      json={"title": "Plan delivery", "due_at": (now + timedelta(days=3)).isoformat(), "assignee_user_id": owner.user_id})  # fmt: skip
    naive = await client.post(
        f"{base}/tasks", headers=owner.headers, json={"title": "x", "due_at": "2026-12-01T10:00:00"}
    )
    assert naive.status_code == 422  # timezone required

    assert [
        t["title"] for t in (await client.get(f"{base}/tasks?due=overdue", headers=owner.headers)).json()
    ] == ["Send invoice"]
    assert [
        t["title"] for t in (await client.get(f"{base}/tasks?due=upcoming", headers=owner.headers)).json()
    ] == ["Plan delivery"]
    assert [
        t["title"] for t in (await client.get(f"{base}/tasks?scope=mine", headers=owner.headers)).json()
    ] == ["Plan delivery"]

    done = await client.patch(
        f"{base}/tasks/{overdue.json()['id']}", headers=owner.headers, json={"completed": True}
    )
    assert done.json()["completed_at"] is not None
    timeline = [
        a["activity_type"]
        for a in (
            await client.get(f"{base}/contacts/{contact['id']}/activities", headers=owner.headers)
        ).json()
    ]
    assert {"lead.created", "lead.stage_changed", "task.created", "task.completed"} <= set(timeline)


async def test_crm_permissions_and_isolation(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "crm-iso@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    contact = (
        await client.post(f"{base}/contacts", headers=owner.headers, json={"display_name": "Secret Co"})
    ).json()
    lead = (
        await client.post(
            f"{base}/leads", headers=owner.headers, json={"contact_id": contact["id"], "title": "Deal"}
        )
    ).json()

    await client.post(
        f"{base}/invitations",
        headers=owner.headers,
        json={"email": "crm-viewer@example.com", "role_key": "viewer"},
    )
    invite_token = token_from(outbox[-1])
    viewer_client: AsyncClient = make_client()  # type: ignore[operator]
    viewer = await register(viewer_client, "crm-viewer@example.com")
    await viewer_client.post(
        "/api/v1/invitations/accept", headers=viewer.headers, json={"token": invite_token}
    )
    assert (await viewer_client.get(f"{base}/contacts", headers=viewer.headers)).json()["total"] == 1
    assert (
        await viewer_client.post(f"{base}/contacts", headers=viewer.headers, json={"display_name": "x"})
    ).status_code == 403
    assert (
        await viewer_client.patch(
            f"{base}/leads/{lead['id']}", headers=viewer.headers, json={"stage": "LOST"}
        )
    ).status_code == 403

    other_client: AsyncClient = make_client()  # type: ignore[operator]
    other = await register(other_client, "crm-other@example.com", "Other Org")
    obase = f"/api/v1/organizations/{other.org_id}"
    assert (
        await other_client.get(f"{obase}/contacts/{contact['id']}", headers=other.headers)
    ).status_code == 404
    assert (
        await other_client.patch(
            f"{obase}/leads/{lead['id']}", headers=other.headers, json={"title": "pwned"}
        )
    ).status_code == 404
    assert (await other_client.get(f"{obase}/leads", headers=other.headers)).json()["items"] == []
    cross = await other_client.post(
        f"{obase}/leads", headers=other.headers, json={"contact_id": contact["id"], "title": "steal"}
    )
    assert cross.status_code == 404
    await viewer_client.aclose()
    await other_client.aclose()
