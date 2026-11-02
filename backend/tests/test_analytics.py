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
