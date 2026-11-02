from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import register


@pytest.mark.asyncio
async def test_analytics_overview(client: AsyncClient) -> None:
    a = await register(client, "owner-analytics@example.com")

    # Initial overview
    res = await client.get(
        f"/api/v1/organizations/{a.org_id}/analytics/overview",
        headers=a.headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["new_conversations"] == 0
    assert data["active_leads_count"] == 0
    assert data["total_pipeline_value"] == 0.0

    # Create a contact and a lead with value
    c_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/contacts",
        headers=a.headers,
        json={"phone_number": "+1999888777", "display_name": "Valued Lead"},
    )
    contact_id = c_res.json()["id"]

    await client.post(
        f"/api/v1/organizations/{a.org_id}/leads",
        headers=a.headers,
        json={
            "contact_id": contact_id,
            "title": "Enterprise Subscription",
            "stage": "QUALIFIED",
            "value_amount": 12500.0,
            "currency": "INR",
        },
    )

    # Create an overdue task
    yesterday = (datetime.now(UTC) - timedelta(days=1)).isoformat()
    await client.post(
        f"/api/v1/organizations/{a.org_id}/tasks",
        headers=a.headers,
        json={"title": "Urgent Review", "due_at": yesterday, "contact_id": contact_id},
    )

    # Check updated overview
    updated = await client.get(
        f"/api/v1/organizations/{a.org_id}/analytics/overview",
        headers=a.headers,
    )
    assert updated.status_code == 200
    u_data = updated.json()
    assert u_data["active_leads_count"] == 1
    assert u_data["total_pipeline_value"] == 12500.0
    assert u_data["overdue_tasks_count"] == 1


@pytest.mark.asyncio
async def test_full_analytics(client: AsyncClient) -> None:
    a = await register(client, "owner-full-analytics@example.com")

    res = await client.get(
        f"/api/v1/organizations/{a.org_id}/analytics?range=7d",
        headers=a.headers,
    )
    assert res.status_code == 200, res.text
    data = res.json()

    assert "overview" in data
    assert "conversations" in data
    assert "messages" in data
    assert "crm" in data
    assert "workflows" in data

    # Verify messages series has 7 or 8 day buckets
    assert len(data["messages"]) >= 7

    # Check lead stages
    assert isinstance(data["crm"]["leads_by_stage"], list)


@pytest.mark.asyncio
async def test_analytics_csv_export(client: AsyncClient) -> None:
    a = await register(client, "owner-export@example.com")

    # Create contact & lead to export
    c_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/contacts",
        headers=a.headers,
        json={"phone_number": "+1234567890", "display_name": "Export Lead"},
    )
    contact_id = c_res.json()["id"]

    await client.post(
        f"/api/v1/organizations/{a.org_id}/leads",
        headers=a.headers,
        json={
            "contact_id": contact_id,
            "title": "Deal to Export",
            "stage": "NEW",
            "value_amount": 450.0,
        },
    )

    for export_type in ("conversations", "messages", "leads", "workflows"):
        res = await client.get(
            f"/api/v1/organizations/{a.org_id}/analytics/export?type={export_type}",
            headers=a.headers,
        )
        assert res.status_code == 200, f"Failed for {export_type}: {res.text}"
        assert res.headers["content-type"].startswith("text/csv")
        assert f'filename="analytics-{export_type}.csv"' in res.headers["content-disposition"]
        text = res.text
        assert "ID" in text.splitlines()[0]
        if export_type == "leads":
            assert "Deal to Export" in text


@pytest.mark.asyncio
async def test_analytics_tenant_isolation(client: AsyncClient, make_client: Any) -> None:
    a = await register(client, "owner-a-ana@example.com")

    # A creates a lead with value
    c_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/contacts",
        headers=a.headers,
        json={"phone_number": "+1112223334", "display_name": "A Lead"},
    )
    await client.post(
        f"/api/v1/organizations/{a.org_id}/leads",
        headers=a.headers,
        json={"contact_id": c_res.json()["id"], "title": "A Secret Deal", "value_amount": 99999.0},
    )

    client_b = make_client()
    b = await register(client_b, "owner-b-ana@example.com")

    # B querying A's analytics gets 404
    forbidden = await client_b.get(
        f"/api/v1/organizations/{a.org_id}/analytics",
        headers=b.headers,
    )
    assert forbidden.status_code == 404

    # B querying its own analytics sees 0 pipeline value and 0 leads
    b_res = await client_b.get(
        f"/api/v1/organizations/{b.org_id}/analytics/overview",
        headers=b.headers,
    )
    assert b_res.status_code == 200
    assert b_res.json()["total_pipeline_value"] == 0.0
    assert b_res.json()["active_leads_count"] == 0


async def test_analytics_ranges_exports_and_response_time(client: AsyncClient, gateway: Any) -> None:
    from app.workers.channel_events import process_event
    from tests.test_channels import connected
    from tests.test_inbox import received_from

    a = await register(client, "analytics-fixes@example.com")
    base = f"/api/v1/organizations/{a.org_id}/analytics"
    conn = await connected(a, gateway)
    await process_event(received_from(a, conn, "919811122233", "Mallory", '=HYPERLINK("http://evil","x")'))  # type: ignore[arg-type]
    convs = (
        await client.get(f"/api/v1/organizations/{a.org_id}/conversations?view=all", headers=a.headers)
    ).json()
    conv_id = convs["items"][0]["id"]
    sent = await client.post(f"/api/v1/organizations/{a.org_id}/conversations/{conv_id}/messages",
                             headers=a.headers, json={"text": "Hello!", "client_message_id": "analytics-1"})  # fmt: skip
    assert sent.status_code in (200, 201), sent.text

    full = (await client.get(f"{base}?range=30d", headers=a.headers)).json()
    # Headline numbers follow the selected range (they used to be fixed to 7 days).
    assert full["overview"]["new_conversations"] == 1 and full["range"] == "30d"
    assert full["overview"]["total_messages_in"] == 1 and full["overview"]["total_messages_out"] == 1
    assert full["overview"]["avg_response_time_seconds"] is not None
    assert sum(d["inbound"] for d in full["messages"]) == 1 and len(full["messages"]) >= 30
    assert full["workflows"]["success_rate"] is None  # no finished runs: no rate, not 100%

    assert (await client.get(f"{base}?range=1y", headers=a.headers)).status_code == 422
    assert (await client.get(f"{base}?range=custom", headers=a.headers)).status_code == 422
    custom = await client.get(f"{base}?range=custom&from_date=2026-01-01T00:00:00&to_date=2026-02-01T00:00:00",
                              headers=a.headers)  # fmt: skip
    assert custom.status_code == 200 and custom.json()["overview"]["new_conversations"] == 0
    assert (await client.get(f"{base}/export?type=users", headers=a.headers)).status_code == 422

    csv_text = (await client.get(f"{base}/export?type=messages", headers=a.headers)).text
    assert "'=HYPERLINK" in csv_text and ",=HYPERLINK" not in csv_text
