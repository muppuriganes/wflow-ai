"""Workflow builder API, graph validation and the Temporal engine end to end.

Engine tests run real workflows on the Temporal dev server from docker compose (`docker compose up -d`),
with WORKFLOW_TIME_SCALE compressing hours into seconds.
"""

import asyncio
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.core.email import OutgoingEmail
from app.database.session import SessionFactory, set_rls_context
from app.models import Conversation, ConversationNote, FollowUpTask, Lead
from app.workers.channel_events import process_event
from app.workflow_engine import actions
from app.workflow_engine.expressions import compare, keywords_match, render, within_business_hours
from app.workflow_engine.graph import compile_definition
from app.workflow_engine.nodes import REGISTRY, ConfigError, validate_config
from tests.conftest import Account, register, token_from
from tests.fakes import FakeGateway
from tests.test_channels import connected
from tests.test_inbox import received_from


def node(node_id: str, node_type: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": node_id,
        "type": "wflow",
        "position": {"x": 0, "y": 0},
        "data": {"nodeType": node_type, "config": config or {}},
    }


def edge(source: str, target: str, handle: str = "out") -> dict[str, Any]:
    return {"id": f"{source}-{handle}-{target}", "source": source, "target": target, "sourceHandle": handle}


def chain(*nodes: dict[str, Any]) -> dict[str, Any]:
    return {
        "nodes": list(nodes),
        "edges": [edge(a["id"], b["id"]) for a, b in zip(nodes, nodes[1:], strict=False)],
    }


# --- Pure units ----------------------------------------------------------------------------


def test_graph_validation_rules() -> None:
    assert not compile_definition({"nodes": [], "edges": []}).ok
    two = compile_definition(
        {"nodes": [node("a", "trigger.manual"), node("b", "trigger.manual")], "edges": []}
    )
    assert "only have one trigger" in two.errors[0].message

    loop = {
        "nodes": [node("t", "trigger.manual"), node("a", "data.set_variable", {"name": "x", "value": "1"}),
                  node("b", "data.set_variable", {"name": "y", "value": "2"})],
        "edges": [edge("t", "a"), edge("a", "b"), edge("b", "a")],
    }  # fmt: skip
    assert any("loop" in e.message for e in compile_definition(loop).errors)

    bad_handle = {
        "nodes": [node("t", "trigger.manual"), node("a", "logic.stop")],
        "edges": [edge("t", "a", "true")],
    }
    assert any("output" in e.message for e in compile_definition(bad_handle).errors)

    needs_conv = chain(node("t", "trigger.webhook"), node("s", "action.send_message", {"text": "hi"}))
    result = compile_definition(needs_conv)
    assert result.errors[0].node_id == "s" and "needs a conversation" in result.errors[0].message

    with_orphan = chain(node("t", "trigger.new_contact"), node("n", "action.add_note", {"body": "x"}))
    with_orphan["nodes"].append(node("lonely", "logic.stop"))
    ok = compile_definition(with_orphan)
    assert ok.ok and any(w.node_id == "lonely" for w in ok.warnings)
    assert set(ok.plan["nodes"]) == {"t", "n"} and ok.plan["edges"]["t"]["out"] == ["n"]  # type: ignore[index]


def test_node_config_validation() -> None:
    with pytest.raises(ConfigError, match="required"):
        validate_config(REGISTRY["action.send_message"], {})
    with pytest.raises(ConfigError, match="between"):
        validate_config(REGISTRY["logic.delay"], {"amount": 0, "unit": "minutes"})
    with pytest.raises(ConfigError, match="letters"):
        validate_config(REGISTRY["data.set_variable"], {"name": "bad name"})
    clean = validate_config(REGISTRY["condition.keywords"], {"keywords": [" price ", "", "cost"], "junk": 1})
    assert clean == {"keywords": ["price", "cost"]}


def test_expressions_are_data_not_code() -> None:
    ctx = {"contact": {"name": "Ravi"}, "variables": {"order": "A1"}, "x": {"__class__": "nope"}}
    assert (
        render("Hi {{contact.name}}, order {{ variables.order }}{{missing.path}}", ctx) == "Hi Ravi, order A1"
    )
    assert render("{{__import__('os')}}", ctx) == "{{__import__('os')}}"
    assert compare("Price list", "contains", "price") and not compare("a", "greater_than", "b")
    assert compare("12", "greater_than", "9")
    assert keywords_match("What's the PRICE?", ["price"]) and not keywords_match("priceless", ["price"])
    assert keywords_match("track my order please", ["track order", "my order"])
    monday_10_ist = datetime(2026, 11, 2, 4, 30, tzinfo=UTC)  # 10:00 in Asia/Kolkata
    assert within_business_hours(monday_10_ist, "Asia/Kolkata", ["mon"], "09:00", "18:00")
    assert not within_business_hours(monday_10_ist, "UTC", ["mon"], "09:00", "18:00")
    assert within_business_hours(datetime(2026, 11, 2, 23, 0, tzinfo=UTC), "UTC", ["mon"], "22:00", "06:00")


# --- Builder API ---------------------------------------------------------------------------


async def test_publish_versions_and_permissions(
    client: AsyncClient, make_client: object, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-owner@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    created = await client.post(f"{base}/workflows", headers=owner.headers, json={"name": "Greeter"})
    assert created.status_code == 201 and created.json()["status"] == "draft"
    wf = created.json()["id"]

    bad = await client.post(f"{base}/workflows/{wf}/publish", headers=owner.headers)
    assert bad.json()["validation"]["ok"] is False and bad.json()["workflow"]["published_version"] is None

    definition = chain(node("t", "trigger.manual"), node("n", "action.add_note", {"body": "Hello"}))
    await client.patch(f"{base}/workflows/{wf}", headers=owner.headers, json={"definition": definition})
    published = (await client.post(f"{base}/workflows/{wf}/publish", headers=owner.headers)).json()
    assert published["validation"]["ok"] and published["workflow"]["published_version"] == 1
    assert (
        published["workflow"]["status"] == "active" and not published["workflow"]["has_unpublished_changes"]
    )

    moved = {**definition, "nodes": [{**n, "position": {"x": 99, "y": 5}} for n in definition["nodes"]]}
    after_move = (
        await client.patch(f"{base}/workflows/{wf}", headers=owner.headers, json={"definition": moved})
    ).json()
    assert after_move["has_unpublished_changes"] is False  # layout changes don't count

    changed = chain(node("t", "trigger.manual"), node("n", "action.add_note", {"body": "Hello v2"}))
    await client.patch(f"{base}/workflows/{wf}", headers=owner.headers, json={"definition": changed})
    assert (await client.get(f"{base}/workflows/{wf}", headers=owner.headers)).json()[
        "has_unpublished_changes"
    ]
    await client.post(f"{base}/workflows/{wf}/publish", headers=owner.headers)
    versions = (await client.get(f"{base}/workflows/{wf}/versions", headers=owner.headers)).json()
    assert [(v["version"], v["is_current"]) for v in versions] == [(2, True), (1, False)]
    restored = await client.post(
        f"{base}/workflows/{wf}/versions/{versions[1]['id']}/restore", headers=owner.headers
    )
    assert restored.json()["definition"]["nodes"][1]["data"]["config"]["body"] == "Hello"

    copy = await client.post(f"{base}/workflows/{wf}/duplicate", headers=owner.headers)
    assert copy.json()["name"] == "Copy of Greeter" and copy.json()["status"] == "draft"
    paused = await client.post(
        f"{base}/workflows/{wf}/status", headers=owner.headers, json={"status": "paused"}
    )
    assert paused.json()["status"] == "paused"
    types = (await client.get(f"{base}/workflow-node-types", headers=owner.headers)).json()
    assert len(types) == len(REGISTRY) and {"type", "fields", "outputs"} <= set(types[0])

    # Viewers can look but not change; other organizations can't even see it.
    await client.post(
        f"{base}/invitations",
        headers=owner.headers,
        json={"email": "wf-viewer@example.com", "role_key": "viewer"},
    )
    invite = token_from(outbox[-1])
    viewer_client: AsyncClient = make_client()  # type: ignore[operator]
    viewer = await register(viewer_client, "wf-viewer@example.com")
    await viewer_client.post("/api/v1/invitations/accept", headers=viewer.headers, json={"token": invite})
    assert (await viewer_client.get(f"{base}/workflows/{wf}", headers=viewer.headers)).status_code == 200
    assert (
        await viewer_client.patch(f"{base}/workflows/{wf}", headers=viewer.headers, json={"name": "x"})
    ).status_code == 403
    assert (
        await viewer_client.post(f"{base}/workflows/{wf}/publish", headers=viewer.headers)
    ).status_code == 403
    other_client: AsyncClient = make_client()  # type: ignore[operator]
    other = await register(other_client, "wf-other@example.com", "Other Org")
    assert (
        await other_client.get(f"/api/v1/organizations/{other.org_id}/workflows/{wf}", headers=other.headers)
    ).status_code == 404
    await viewer_client.aclose()
    await other_client.aclose()


async def test_publish_rejects_dangling_references(client: AsyncClient, outbox: list[OutgoingEmail]) -> None:
    owner = await register(client, "wf-refs@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    definition = chain(
        node("t", "trigger.new_contact"), node("a", "action.add_tag", {"tag_id": str(uuid.uuid4())})
    )
    wf = (
        await client.post(
            f"{base}/workflows", headers=owner.headers, json={"name": "Tagger", "definition": definition}
        )
    ).json()
    res = (await client.post(f"{base}/workflows/{wf['id']}/publish", headers=owner.headers)).json()
    assert not res["validation"]["ok"] and "tag" in res["validation"]["errors"][0]["message"]


# --- Engine (Temporal) ---------------------------------------------------------------------


async def _publish(acct: Account, name: str, definition: dict[str, Any]) -> str:
    base = f"/api/v1/organizations/{acct.org_id}"
    wf = (
        await acct.client.post(
            f"{base}/workflows", headers=acct.headers, json={"name": name, "definition": definition}
        )
    ).json()
    res = (await acct.client.post(f"{base}/workflows/{wf['id']}/publish", headers=acct.headers)).json()
    assert res["validation"]["ok"], res["validation"]
    return str(wf["id"])


async def _runs(acct: Account, workflow_id: str) -> list[dict[str, Any]]:
    res = await acct.client.get(
        f"/api/v1/organizations/{acct.org_id}/workflow-runs?workflow_id={workflow_id}", headers=acct.headers
    )
    return list(res.json()["items"])


async def _wait(acct: Account, run_id: str, statuses: set[str], timeout: float = 30) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout
    while True:
        run = (
            await acct.client.get(
                f"/api/v1/organizations/{acct.org_id}/workflow-runs/{run_id}", headers=acct.headers
            )
        ).json()
        if run["status"] in statuses:
            return dict(run)
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError(f"run stuck in {run['status']}: {run.get('error')} {run.get('nodes')}")
        await asyncio.sleep(0.2)


async def _first_run(acct: Account, workflow_id: str, timeout: float = 10) -> dict[str, Any]:
    deadline = asyncio.get_running_loop().time() + timeout
    while not (runs := await _runs(acct, workflow_id)):
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("no run started")
        await asyncio.sleep(0.2)
    return runs[0]


async def _in_org(org_id: str) -> Any:
    db = SessionFactory()
    await set_rls_context(db, user_id=None, org_id=uuid.UUID(org_id))
    return db


@pytest.mark.usefixtures("temporal_worker")
async def test_inbound_message_runs_actions_with_durable_delay(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-e2e@example.com")
    conn = await connected(owner, gateway)
    tag = (
        await client.post(
            f"/api/v1/organizations/{owner.org_id}/tags", headers=owner.headers, json={"name": "Price ask"}
        )
    ).json()
    wf = await _publish(owner, "Price enquiries", chain(
        node("t", "trigger.message_received", {"keywords": ["price"]}),
        node("send", "action.send_message", {"text": "Hi {{contact.name}}, our price list is on its way!"}),
        node("tag", "action.add_tag", {"tag_id": tag["id"]}),
        node("lead", "action.create_lead", {"title": "Price enquiry from {{contact.name}}", "value": 1500}),
        node("wait", "logic.delay", {"amount": 1, "unit": "hours"}),
        node("note", "action.add_note", {"body": "Follow-up sent after delay to {{contact.phone}}"}),
    ))  # fmt: skip

    await process_event(received_from(owner, conn, "919811100001", "Ravi", "hello there"))  # type: ignore[arg-type]
    await asyncio.sleep(0.5)
    assert await _runs(owner, wf) == []  # no keyword, no run

    ev = received_from(owner, conn, "919811100001", "Ravi", "What is the PRICE?")
    await process_event(ev)  # type: ignore[arg-type]
    await process_event(ev)  # type: ignore[arg-type]  # redelivery: still one run
    run = await _wait(owner, (await _first_run(owner, wf))["id"], {"COMPLETED", "FAILED"})
    assert run["status"] == "COMPLETED", run
    assert len(await _runs(owner, wf)) == 1
    assert [n["node_id"] for n in run["nodes"]] == ["t", "send", "tag", "lead", "wait", "note"]
    assert all(n["status"] == "completed" for n in run["nodes"])
    sends = [c for c in gateway.calls if c[0] == "send"]
    assert sends[-1][1][1] == "Hi Ravi, our price list is on its way!"

    async with await _in_org(owner.org_id) as db:
        lead = await db.scalar(select(Lead).where(Lead.organization_id == uuid.UUID(owner.org_id)))
        assert (
            lead.title == "Price enquiry from Ravi"
            and float(lead.value_amount) == 1500
            and lead.source == "workflow"
        )
        notes = (await db.scalars(select(ConversationNote.body))).all()
        assert notes == ["[Automation] Follow-up sent after delay to 919811100001"]
    convs = (
        await client.get(
            f"/api/v1/organizations/{owner.org_id}/conversations?view=all", headers=owner.headers
        )
    ).json()
    assert [t["name"] for t in convs["items"][0]["contact"]["tags"]] == ["Price ask"]


@pytest.mark.usefixtures("temporal_worker")
async def test_wait_for_reply_resumes_instead_of_starting_new_runs(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-reply@example.com")
    conn = await connected(owner, gateway)
    definition = {
        "nodes": [
            node("t", "trigger.message_received", {"keywords": ["track"]}),
            node("ask", "action.send_message", {"text": "Sure! What's your order number?"}),
            node("w", "logic.wait_for_reply", {"timeout_minutes": 60}),
            node("check", "condition.compare", {"field": "message.text", "operator": "starts_with", "value": "ORD"}),
            node("yes", "action.add_note", {"body": "Track {{message.text}}"}),
            node("no", "action.add_note", {"body": "Unrecognised reply"}),
            node("late", "action.send_message", {"text": "No problem, write any time."}),
        ],
        "edges": [edge("t", "ask"), edge("ask", "w"), edge("w", "check", "replied"), edge("w", "late", "timeout"),
                  edge("check", "yes", "true"), edge("check", "no", "false")],
    }  # fmt: skip
    wf = await _publish(owner, "Order tracking", definition)

    await process_event(received_from(owner, conn, "919811100002", "Meera", "I want to track my order"))  # type: ignore[arg-type]
    run_id = (await _first_run(owner, wf))["id"]
    waiting = await _wait(owner, run_id, {"WAITING"})
    assert waiting["waiting_for"] == "reply"
    # The reply contains "track" again, but resumes the waiting run instead of starting another.
    await process_event(received_from(owner, conn, "919811100002", "Meera", "ORD-1234 track"))  # type: ignore[arg-type]
    done = await _wait(owner, run_id, {"COMPLETED", "FAILED"})
    assert done["status"] == "COMPLETED" and len(await _runs(owner, wf)) == 1
    outcomes = {n["node_id"]: n["outcome"] for n in done["nodes"]}
    assert outcomes["w"] == "replied" and outcomes["check"] == "true" and "late" not in outcomes
    async with await _in_org(owner.org_id) as db:
        assert (await db.scalars(select(ConversationNote.body))).all() == [
            "[Automation] Track ORD-1234 track"
        ]

    # Second customer never answers: the timeout branch runs (60 minutes compressed).
    await process_event(received_from(owner, conn, "919811100003", "Kiran", "track please"))  # type: ignore[arg-type]
    await asyncio.sleep(0.5)
    second = [r for r in await _runs(owner, wf) if r["id"] != run_id][0]
    timed_out = await _wait(owner, second["id"], {"COMPLETED", "FAILED"})
    assert {n["node_id"]: n["outcome"] for n in timed_out["nodes"]}["w"] == "timeout"
    assert gateway.calls[-1][1][1] == "No problem, write any time."


@pytest.mark.usefixtures("temporal_worker")
async def test_approval_flow_and_permissions(
    client: AsyncClient, make_client: object, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-approve@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919811100004", "Arjun", "hi"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    conv_id = (await client.get(f"{base}/conversations?view=all", headers=owner.headers)).json()["items"][0][
        "id"
    ]
    definition = {
        "nodes": [
            node("t", "trigger.manual"),
            node(
                "ok",
                "human.approval",
                {"title": "Give {{contact.name}} a 10% discount?", "timeout_hours": 24},
            ),
            node(
                "task",
                "action.create_task",
                {"title": "Send discount code to {{contact.name}}", "due_in_hours": 2},
            ),
            node("nope", "action.add_note", {"body": "Discount declined"}),
        ],
        "edges": [edge("t", "ok"), edge("ok", "task", "approved"), edge("ok", "nope", "rejected")],
    }
    wf = await _publish(owner, "Discount approval", definition)
    started = await client.post(
        f"{base}/workflows/{wf}/execute", headers=owner.headers, json={"conversation_id": conv_id}
    )
    assert started.status_code == 202
    run_id = started.json()["id"]
    await _wait(owner, run_id, {"WAITING"})
    pending = (await client.get(f"{base}/approvals?status=pending", headers=owner.headers)).json()
    assert (
        pending[0]["title"] == "Give Arjun a 10% discount?"
        and pending[0]["workflow_name"] == "Discount approval"
    )

    await client.post(
        f"{base}/invitations",
        headers=owner.headers,
        json={"email": "wf-agent@example.com", "role_key": "agent_operator"},
    )
    invite = token_from(outbox[-1])
    agent_client: AsyncClient = make_client()  # type: ignore[operator]
    agent = await register(agent_client, "wf-agent@example.com")
    await agent_client.post("/api/v1/invitations/accept", headers=agent.headers, json={"token": invite})
    denied = await agent_client.post(
        f"{base}/approvals/{pending[0]['id']}/decision", headers=agent.headers, json={"decision": "approved"}
    )
    assert denied.status_code == 403

    decided = await client.post(f"{base}/approvals/{pending[0]['id']}/decision", headers=owner.headers,
                                json={"decision": "approved", "note": "VIP"})  # fmt: skip
    assert decided.json()["status"] == "approved" and decided.json()["decided_by"]
    again = await client.post(
        f"{base}/approvals/{pending[0]['id']}/decision", headers=owner.headers, json={"decision": "rejected"}
    )
    assert again.status_code == 409
    done = await _wait(owner, run_id, {"COMPLETED", "FAILED"})
    assert {n["node_id"]: n["outcome"] for n in done["nodes"]}["ok"] == "approved"
    async with await _in_org(owner.org_id) as db:
        task = await db.scalar(select(FollowUpTask))
        assert task.title == "Send discount code to Arjun" and task.due_at is not None
    await agent_client.aclose()


@pytest.mark.usefixtures("temporal_worker")
async def test_human_takeover_stops_automation(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-handover@example.com")
    conn = await connected(owner, gateway)
    wf = await _publish(owner, "Escalate", chain(
        node("t", "trigger.message_received", {"keywords": ["agent", "human"]}),
        node("h", "human.handover", {"user_id": owner.user_id, "note": "Customer asked for a person"}),
    ))  # fmt: skip
    await process_event(received_from(owner, conn, "919811100005", "Dev", "can I talk to a human"))  # type: ignore[arg-type]
    run = await _wait(owner, (await _first_run(owner, wf))["id"], {"COMPLETED", "FAILED"})
    assert run["status"] == "COMPLETED"
    convs = (
        await client.get(
            f"/api/v1/organizations/{owner.org_id}/conversations?view=all", headers=owner.headers
        )
    ).json()
    assert (
        convs["items"][0]["automation_paused"] is True
        and convs["items"][0]["assignee"]["id"] == owner.user_id
    )
    # While a person handles the conversation, nothing triggers.
    await process_event(received_from(owner, conn, "919811100005", "Dev", "human please, again"))  # type: ignore[arg-type]
    await asyncio.sleep(1)
    assert len(await _runs(owner, wf)) == 1


@pytest.mark.usefixtures("temporal_worker")
async def test_test_runs_have_no_side_effects(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-test@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919811100006", "Asha", "hi"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    conv_id = (await client.get(f"{base}/conversations?view=all", headers=owner.headers)).json()["items"][0][
        "id"
    ]
    definition = chain(
        node("t", "trigger.manual"),
        node("v", "data.set_variable", {"name": "greeting", "value": "Namaste {{contact.name}}"}),
        node("d", "logic.delay", {"amount": 3, "unit": "days"}),
        node("s", "action.send_message", {"text": "{{variables.greeting}}!"}),
    )
    wf = (
        await client.post(
            f"{base}/workflows", headers=owner.headers, json={"name": "Draft", "definition": definition}
        )
    ).json()
    sends_before = len([c for c in gateway.calls if c[0] == "send"])
    res = (
        await client.post(
            f"{base}/workflows/{wf['id']}/test", headers=owner.headers, json={"conversation_id": conv_id}
        )
    ).json()
    assert res["validation"]["ok"] and res["run"]["is_test"]
    run = await _wait(owner, res["run"]["id"], {"COMPLETED", "FAILED"})
    outputs = {n["node_id"]: n["output"] for n in run["nodes"]}
    assert outputs["s"]["description"] == "Would send: “Namaste Asha!”"
    assert "skipped" in outputs["d"]["note"]
    assert len([c for c in gateway.calls if c[0] == "send"]) == sends_before
    # Test runs are hidden from the normal run list unless asked for.
    assert (await client.get(f"{base}/workflow-runs", headers=owner.headers)).json()["total"] == 0
    assert (await client.get(f"{base}/workflow-runs?include_tests=true", headers=owner.headers)).json()[
        "total"
    ] == 1


@pytest.mark.usefixtures("temporal_worker")
async def test_failure_is_recorded_and_retry_succeeds(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail], monkeypatch: pytest.MonkeyPatch
) -> None:
    owner = await register(client, "wf-fail@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919811100007", "Nina", "hi"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    conv_id = (await client.get(f"{base}/conversations?view=all", headers=owner.headers)).json()["items"][0][
        "id"
    ]
    wf = await _publish(
        owner, "Flaky", chain(node("t", "trigger.manual"), node("n", "action.add_note", {"body": "ok"}))
    )

    async def broken(*_: Any) -> dict[str, Any]:
        raise RuntimeError("CRM is down")

    monkeypatch.setitem(actions.ACTIONS, "action.add_note", broken)
    run_id = (
        await client.post(
            f"{base}/workflows/{wf}/execute", headers=owner.headers, json={"conversation_id": conv_id}
        )
    ).json()["id"]
    failed = await _wait(owner, run_id, {"FAILED", "COMPLETED"})
    assert failed["status"] == "FAILED" and "CRM is down" in failed["error"]
    node_n = next(n for n in failed["nodes"] if n["node_id"] == "n")
    assert node_n["status"] == "failed" and node_n["attempt"] == 5 and failed["retries"] == 4

    monkeypatch.undo()
    retried = await client.post(f"{base}/workflow-runs/{run_id}/retry", headers=owner.headers)
    assert retried.status_code == 202
    ok = await _wait(owner, retried.json()["id"], {"COMPLETED", "FAILED"})
    assert ok["status"] == "COMPLETED" and ok["retry_of_run_id"] == run_id
    assert (
        await client.post(f"{base}/workflow-runs/{ok['id']}/retry", headers=owner.headers)
    ).status_code == 409


@pytest.mark.usefixtures("temporal_worker")
async def test_cancel_waiting_run(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-cancel@example.com")
    base = f"/api/v1/organizations/{owner.org_id}"
    wf = await _publish(owner, "Slow", chain(
        node("t", "trigger.manual"), node("d", "logic.delay", {"amount": 30, "unit": "days"}),
        node("task", "action.create_task", {"title": "never"}),
    ))  # fmt: skip
    run_id = (await client.post(f"{base}/workflows/{wf}/execute", headers=owner.headers, json={})).json()[
        "id"
    ]
    await _wait(owner, run_id, {"WAITING"})
    assert (
        await client.post(f"{base}/workflow-runs/{run_id}/cancel", headers=owner.headers)
    ).status_code == 200
    cancelled = await _wait(owner, run_id, {"CANCELLED"})
    assert "task" not in {n["node_id"] for n in cancelled["nodes"]}
    assert {n["node_id"]: n["status"] for n in cancelled["nodes"]}["d"] == "cancelled"


@pytest.mark.usefixtures("temporal_worker")
async def test_webhook_trigger(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-hook@example.com")
    wf = await _publish(owner, "Website form", chain(
        node("t", "trigger.webhook"),
        node("task", "action.create_task", {"title": "Call back {{webhook.name}} ({{webhook.phone}})"}),
    ))  # fmt: skip
    detail = (
        await client.get(f"/api/v1/organizations/{owner.org_id}/workflows/{wf}", headers=owner.headers)
    ).json()
    path = detail["webhook_url"].split("localhost:8100", 1)[1]
    body = {"name": "Priya", "phone": "+91 98000 11111", "api_key": "should-be-masked"}
    first = await client.post(path, json=body, headers={"Idempotency-Key": "form-42"})
    dup = await client.post(path, json=body, headers={"Idempotency-Key": "form-42"})
    assert (
        first.status_code == 202
        and first.json()["status"] == "accepted"
        and dup.json()["status"] == "duplicate"
    )
    run = await _wait(owner, first.json()["run_id"], {"COMPLETED", "FAILED"})
    assert run["trigger_payload"]["webhook"]["api_key"] == "***"
    async with await _in_org(owner.org_id) as db:
        assert (await db.scalar(select(FollowUpTask.title))) == "Call back Priya (+91 98000 11111)"

    assert (await client.post("/api/v1/hooks/" + "x" * 43, json={})).status_code == 404
    assert (await client.post(path, json=[1, 2])).status_code == 400
    # Pausing the workflow disables its webhook.
    await client.post(
        f"/api/v1/organizations/{owner.org_id}/workflows/{wf}/status",
        headers=owner.headers,
        json={"status": "paused"},
    )
    assert (await client.post(path, json=body)).status_code == 404


async def test_conversation_flag_blocks_manual_runs(
    client: AsyncClient, gateway: FakeGateway, outbox: list[OutgoingEmail]
) -> None:
    owner = await register(client, "wf-flag@example.com")
    conn = await connected(owner, gateway)
    await process_event(received_from(owner, conn, "919811100008", "Om", "hi"))  # type: ignore[arg-type]
    base = f"/api/v1/organizations/{owner.org_id}"
    conv_id = (await client.get(f"{base}/conversations?view=all", headers=owner.headers)).json()["items"][0][
        "id"
    ]
    async with await _in_org(owner.org_id) as db:
        await db.execute(update(Conversation).values(automation_paused=True))
        await db.commit()
    wf = await _publish(
        owner, "Manual", chain(node("t", "trigger.manual"), node("n", "action.add_note", {"body": "x"}))
    )
    res = await client.post(
        f"{base}/workflows/{wf}/execute", headers=owner.headers, json={"conversation_id": conv_id}
    )
    assert res.status_code == 409 and res.json()["error"]["code"] == "human_takeover"
