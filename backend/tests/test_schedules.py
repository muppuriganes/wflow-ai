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


async def test_temporal_fire_starts_runs_once_per_fire(client: AsyncClient, gateway: Any) -> None:
    """The path Temporal takes on each fire: no tenant context at first, and retries must not duplicate."""
    from app.services.schedules import fire_schedule_from_activity
    from app.workers.channel_events import process_event
    from app.workflow_engine import client as engine
    from tests.test_channels import connected
    from tests.test_inbox import received_from

    a = await register(client, "fire@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    wf_id = await _create_workflow(client, a)
    tag = (await client.post(f"{base}/tags", headers=a.headers, json={"name": "Weekly"})).json()
    conn = await connected(a, gateway)
    for phone, name in (("919800000001", "Asha"), ("919800000002", "Ravi"), ("919800000003", "Taken")):
        await process_event(received_from(a, conn, phone, name, "hi"))  # type: ignore[arg-type]
    convs = (await client.get(f"{base}/conversations?view=all", headers=a.headers)).json()["items"]
    for conv in convs:
        await client.put(f"{base}/contacts/{conv['contact']['id']}/tags", headers=a.headers, json=[tag["id"]])
    taken = next(c for c in convs if c["contact"]["display_name"] == "Taken")
    await client.post(
        f"{base}/conversations/{taken['id']}/takeover", headers=a.headers, json={"automation_paused": True}
    )

    sched = (await client.post(f"{base}/schedules", headers=a.headers, json={
        "workflow_id": wf_id, "name": "Weekly hello", "schedule_type": "weekly",
        "config": {"days": ["mon"], "time": "09:00"}, "target_tag_id": tag["id"],
    })).json()  # fmt: skip
    assert sched["next_run_at"], "Temporal schedule should report its next fire"
    desc = (
        await (await engine.get_client())
        .get_schedule_handle(engine.temporal_sched_id(sched["id"]))
        .describe()
    )
    from zoneinfo import ZoneInfo

    upcoming = [t.astimezone(ZoneInfo(sched["timezone"])) for t in desc.info.next_action_times]
    assert upcoming and all((t.weekday(), t.hour, t.minute) == (0, 9, 0) for t in upcoming)

    fire_key = "wf-sched-x-2026-11-09T03:30:00Z"
    first = await fire_schedule_from_activity(sched["id"], fire_key)
    retry = await fire_schedule_from_activity(sched["id"], fire_key)
    assert first == {"ok": True, "runs_started": 2}  # the taken-over conversation is skipped
    assert retry == {"ok": True, "runs_started": 0}

    await client.post(f"{base}/schedules/{sched['id']}/pause", headers=a.headers)
    assert (await fire_schedule_from_activity(sched["id"], "next"))["skipped"] == "Schedule is paused"
    await client.delete(f"{base}/schedules/{sched['id']}", headers=a.headers)
    assert (await fire_schedule_from_activity(sched["id"], "later"))["ok"] is False


async def test_schedule_validation(client: AsyncClient) -> None:
    a = await register(client, "sched-validate@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    wf_id = await _create_workflow(client, a)

    async def create(schedule_type: str, config: dict[str, Any], **extra: Any) -> Any:
        body = {"workflow_id": wf_id, "name": "x", "schedule_type": schedule_type, "config": config, **extra}
        return await client.post(f"{base}/schedules", headers=a.headers, json=body)

    assert (await create("daily", {"time": "25:00"})).status_code == 422
    assert (await create("cron", {"cron_expression": "* * *"})).status_code == 422
    assert (await create("cron", {"cron_expression": "0 9 * * MON; rm"})).status_code == 422
    assert (await create("cron", {"cron_expression": "0 30 * * *"})).status_code == 422
    assert (await create("once", {})).status_code == 422  # used to silently become daily
    assert (await create("once", {"date": "2020-01-01"})).status_code == 422
    assert (await create("daily", {}, timezone="Mars/Olympus")).status_code == 422
    ok = await create("once", {"date": "2099-01-01", "time": "10:30", "junk": 1}, timezone="Asia/Kolkata")
    assert ok.status_code == 201 and ok.json()["config"] == {"time": "10:30", "date": "2099-01-01"}
    assert ok.json()["next_run_at"].startswith("2099-01-01T05:00")  # 10:30 IST in UTC

    # Only published workflows that start "On a schedule" can be scheduled.
    other = (await client.post(f"{base}/workflows", headers=a.headers, json={"name": "Keyword", "definition": {
        "nodes": [node("t", "trigger.message_received", {"keywords": ["hi"]}), node("s", "logic.stop")],
        "edges": [edge("t", "s")],
    }})).json()  # fmt: skip
    await client.post(f"{base}/workflows/{other['id']}/publish", headers=a.headers)
    res = await client.post(
        f"{base}/schedules", headers=a.headers, json={"workflow_id": other["id"], "name": "x"}
    )
    assert res.status_code == 422 and res.json()["error"]["code"] == "workflow_not_schedulable"


async def test_scheduled_workflow_can_message_tagged_contacts(client: AsyncClient) -> None:
    """The headline use case: a schedule trigger followed by a WhatsApp message validates."""
    a = await register(client, "sched-send@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    wf = (await client.post(f"{base}/workflows", headers=a.headers, json={"name": "Monday hello", "definition": {
        "nodes": [node("t", "trigger.schedule"), node("s", "action.send_message", {"text": "Hi {{contact.name}}"})],
        "edges": [edge("t", "s")],
    }})).json()  # fmt: skip
    res = (await client.post(f"{base}/workflows/{wf['id']}/publish", headers=a.headers)).json()
    assert res["validation"]["ok"], res["validation"]
    assert "skipped" in res["validation"]["warnings"][0]["message"]


@pytest.mark.usefixtures("temporal_worker")
async def test_temporal_schedule_fires_end_to_end(client: AsyncClient) -> None:
    import asyncio

    from app.workflow_engine import client as engine

    a = await register(client, "fire-e2e@example.com")
    base = f"/api/v1/organizations/{a.org_id}"
    wf_id = await _create_workflow(client, a)
    sched = (await client.post(f"{base}/schedules", headers=a.headers, json={
        "workflow_id": wf_id, "name": "Nightly", "schedule_type": "daily", "config": {"time": "03:00"},
    })).json()  # fmt: skip
    # Fire now through Temporal itself: schedule -> trigger workflow -> activity -> workflow run.
    await (await engine.get_client()).get_schedule_handle(engine.temporal_sched_id(sched["id"])).trigger()
    for _ in range(60):
        runs = (await client.get(f"{base}/workflow-runs?workflow_id={wf_id}", headers=a.headers)).json()[
            "items"
        ]
        if runs and runs[0]["status"] == "COMPLETED":
            break
        await asyncio.sleep(0.25)
    assert [(r["trigger_type"], r["status"]) for r in runs] == [("trigger.schedule", "COMPLETED")]
    refreshed = (await client.get(f"{base}/schedules/{sched['id']}", headers=a.headers)).json()
    assert refreshed["total_runs"] == 1 and refreshed["last_run_at"]
