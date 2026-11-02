from typing import Any

import pytest
from httpx import AsyncClient

from tests.conftest import Account, register


def node(node_id: str, node_type: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "wflow",
        "position": {"x": 0, "y": 0},
        "data": {"nodeType": node_type, "config": config or {}},
    }


def edge(source: str, target: str, handle: str = "out") -> dict[str, Any]:
    return {"id": f"{source}-{handle}-{target}", "source": source, "target": target, "sourceHandle": handle}


async def _create_workflow(c: AsyncClient, a: Account, name: str = "Scheduled Workflow") -> str:
    res = await c.post(
        f"/api/v1/organizations/{a.org_id}/workflows",
        headers=a.headers,
        json={
            "name": name,
            "definition": {
                "nodes": [
                    node("t", "trigger.schedule", {"frequency": "daily", "time": "09:00"}),
                    node("s", "logic.stop", {}),
                ],
                "edges": [edge("t", "s")],
            },
        },
    )
    assert res.status_code == 201, res.text
    wf_id = res.json()["id"]
    pub = await c.post(f"/api/v1/organizations/{a.org_id}/workflows/{wf_id}/publish", headers=a.headers)
    assert pub.status_code == 200, pub.text
    return wf_id


@pytest.mark.asyncio
async def test_schedule_crud(client: AsyncClient) -> None:
    a = await register(client, "owner-sched@example.com")
    wf_id = await _create_workflow(client, a)

    # 1. Create schedule
    res = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules",
        headers=a.headers,
        json={
            "workflow_id": wf_id,
            "name": "Daily Morning Sync",
            "description": "Runs every day at 9am",
            "schedule_type": "daily",
            "config": {"time": "09:00"},
        },
    )
    assert res.status_code == 201, res.text
    sched = res.json()
    assert sched["name"] == "Daily Morning Sync"
    assert sched["status"] == "active"
    assert sched["schedule_type"] == "daily"
    sched_id = sched["id"]

    # 2. List schedules
    lst = await client.get(f"/api/v1/organizations/{a.org_id}/schedules", headers=a.headers)
    assert lst.status_code == 200
    items = lst.json()
    assert len(items) == 1
    assert items[0]["id"] == sched_id
    assert items[0]["workflow_name"] == "Scheduled Workflow"

    # 3. Get schedule
    get_res = await client.get(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}",
        headers=a.headers,
    )
    assert get_res.status_code == 200
    assert get_res.json()["id"] == sched_id

    # 4. Update schedule
    patch_res = await client.patch(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}",
        headers=a.headers,
        json={"name": "Daily Morning Sync Updated", "config": {"time": "10:00"}},
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["name"] == "Daily Morning Sync Updated"
    assert patch_res.json()["config"]["time"] == "10:00"

    # 5. Delete schedule
    del_res = await client.delete(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}",
        headers=a.headers,
    )
    assert del_res.status_code == 204

    # 6. Verify deleted
    verify = await client.get(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}",
        headers=a.headers,
    )
    assert verify.status_code == 404


@pytest.mark.asyncio
async def test_schedule_pause_and_resume(client: AsyncClient) -> None:
    a = await register(client, "owner-pause@example.com")
    wf_id = await _create_workflow(client, a)

    create = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules",
        headers=a.headers,
        json={"workflow_id": wf_id, "name": "Weekly Report", "schedule_type": "weekly"},
    )
    sched_id = create.json()["id"]

    # Pause
    paused = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}/pause",
        headers=a.headers,
    )
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    # Resume
    resumed = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}/resume",
        headers=a.headers,
    )
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "active"


@pytest.mark.asyncio
async def test_schedule_manual_trigger(client: AsyncClient) -> None:
    a = await register(client, "owner-trigger@example.com")
    wf_id = await _create_workflow(client, a)

    create = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules",
        headers=a.headers,
        json={"workflow_id": wf_id, "name": "Manual Run Schedule"},
    )
    sched_id = create.json()["id"]

    trig = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched_id}/trigger",
        headers=a.headers,
    )
    assert trig.status_code == 200
    assert trig.json()["runs_started"] == 1


@pytest.mark.asyncio
async def test_schedule_target_tag(client: AsyncClient) -> None:
    a = await register(client, "owner-target@example.com")
    wf_id = await _create_workflow(client, a)

    # Create tag
    tag_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/tags",
        headers=a.headers,
        json={"name": "VIP Clients"},
    )
    assert tag_res.status_code == 201
    tag_id = tag_res.json()["id"]

    # Create contact with that tag
    c_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/contacts",
        headers=a.headers,
        json={"phone_number": "+1234567890", "display_name": "Alice VIP"},
    )
    assert c_res.status_code == 201
    contact_id = c_res.json()["id"]
    await client.put(
        f"/api/v1/organizations/{a.org_id}/contacts/{contact_id}/tags",
        headers=a.headers,
        json=[tag_id],
    )

    # Create schedule targeting that tag
    sched_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules",
        headers=a.headers,
        json={
            "workflow_id": wf_id,
            "name": "VIP Weekly Broadcast",
            "target_tag_id": tag_id,
        },
    )
    assert sched_res.status_code == 201
    sched = sched_res.json()
    assert sched["target_tag_id"] == tag_id
    assert sched["target_tag_name"] == "VIP Clients"

    # Trigger now -> should find contact and start a run
    trig = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules/{sched['id']}/trigger",
        headers=a.headers,
    )
    assert trig.status_code == 200
    assert trig.json()["runs_started"] == 1


@pytest.mark.asyncio
async def test_schedule_tenant_isolation(client: AsyncClient, make_client: Any) -> None:
    a = await register(client, "owner-a-sched@example.com")
    wf_id = await _create_workflow(client, a)
    sched_res = await client.post(
        f"/api/v1/organizations/{a.org_id}/schedules",
        headers=a.headers,
        json={"workflow_id": wf_id, "name": "Org A Schedule"},
    )
    sched_id = sched_res.json()["id"]

    client_b = make_client()
    b = await register(client_b, "owner-b-sched@example.com")

    # B cannot view, edit or delete A's schedule
    get_res = await client_b.get(
        f"/api/v1/organizations/{b.org_id}/schedules/{sched_id}",
        headers=b.headers,
    )
    assert get_res.status_code == 404

    patch_res = await client_b.patch(
        f"/api/v1/organizations/{b.org_id}/schedules/{sched_id}",
        headers=b.headers,
        json={"name": "Hacked"},
    )
    assert patch_res.status_code == 404

    del_res = await client_b.delete(
        f"/api/v1/organizations/{b.org_id}/schedules/{sched_id}",
        headers=b.headers,
    )
    assert del_res.status_code == 404
