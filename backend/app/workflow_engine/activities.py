"""Temporal activities: everything that touches the database or the outside world.

Every activity is safe to retry. `execute_node` records each step in node_runs and returns the
stored result if that step already completed (so a retry after a crash never repeats an action).
"""

import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from temporalio import activity

from app.core.logging import get_logger
from app.database.session import SessionFactory, set_rls_context
from app.models import Approval, Contact, ContactTag, Conversation, NodeRun, Organization, WorkflowRun
from app.models.automation import FINISHED_RUN_STATUSES
from app.services.realtime import publish
from app.workflow_engine import actions
from app.workflow_engine.expressions import compare, keywords_match, render, resolve, within_business_hours
from app.workflow_engine.nodes import REGISTRY
from app.workflow_engine.types import ApprovalRequest, NodeInput, NodeRecord, NodeResult, RunInput, RunState

log = get_logger("workflow.activities")


@asynccontextmanager
async def org_session(organization_id: str) -> AsyncIterator[AsyncSession]:
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=uuid.UUID(organization_id))
        yield db


def _now() -> datetime:
    return datetime.now(UTC)


async def _run(db: AsyncSession, run_id: str) -> WorkflowRun:
    run = await db.get(WorkflowRun, uuid.UUID(run_id))
    if run is None:
        raise RuntimeError(f"Run {run_id} not found")
    return run


@activity.defn
async def prepare_run(inp: RunInput) -> dict[str, Any]:
    """Marks the run RUNNING and builds the context (fresh data, never stale trigger snapshots)."""
    async with org_session(inp.organization_id) as db:
        run = await _run(db, inp.run_id)
        org = await db.get(Organization, run.organization_id)
        ctx: dict[str, Any] = {
            "run_id": inp.run_id,
            "test": inp.test,
            "trigger": {"type": run.trigger_type},
            "org": {"name": org.name if org else "", "timezone": org.timezone if org else "UTC"},
            "message": {
                "text": run.trigger_payload.get("message_text"),
                "id": run.trigger_payload.get("message_id"),
            },
            "webhook": run.trigger_payload.get("webhook") or {},
            "variables": {},
            "contact": {},
            "conversation": {},
        }
        if run.contact_id:
            contact = await db.get(Contact, run.contact_id)
            if contact:
                ctx["contact"] = {
                    "id": str(contact.id), "name": contact.display_name or "", "phone": contact.phone_number or "",
                    "email": contact.email or "", "company": contact.company or "",
                }  # fmt: skip
        if run.conversation_id:
            conv = await db.get(Conversation, run.conversation_id)
            if conv:
                ctx["conversation"] = {"id": str(conv.id), "status": conv.status, "priority": conv.priority}
        if run.status not in FINISHED_RUN_STATUSES:
            run.status = "RUNNING"
            run.started_at = run.started_at or _now()
            await db.commit()
        await publish(run.organization_id, "run.updated", run_id=run.id)
        return ctx


@activity.defn
async def set_run_state(state: RunState) -> None:
    async with org_session(state.organization_id) as db:
        run = await _run(db, state.run_id)
        if run.status in FINISHED_RUN_STATUSES:
            return
        run.status = state.status
        run.waiting_for = state.waiting_for if state.status == "WAITING" else None
        if state.error:
            run.error = state.error[:4000]
        if state.status in FINISHED_RUN_STATUSES:
            run.finished_at = _now()
            # A step that was still waiting (delay, reply, approval) never finished.
            await db.execute(
                update(NodeRun)
                .where(NodeRun.run_id == run.id, NodeRun.status.in_(("running", "waiting")))
                .values(
                    status="cancelled" if state.status == "CANCELLED" else "skipped",
                    finished_at=run.finished_at,
                )
            )
        await db.commit()
        await publish(run.organization_id, "run.updated", run_id=run.id)


@activity.defn
async def record_node(rec: NodeRecord) -> None:
    async with org_session(rec.organization_id) as db:
        node = await db.scalar(
            select(NodeRun).where(NodeRun.run_id == uuid.UUID(rec.run_id), NodeRun.node_id == rec.node_id)
        )
        if node is None:
            node = NodeRun(
                organization_id=uuid.UUID(rec.organization_id), run_id=uuid.UUID(rec.run_id), node_id=rec.node_id,
                node_type=rec.node_type, status=rec.status, input=rec.input, started_at=_now(), created_at=_now(),
            )  # fmt: skip
            db.add(node)
        node.status = rec.status
        if rec.outcome is not None:
            node.outcome = rec.outcome
        if rec.output:
            node.output = rec.output
        if rec.status in ("completed", "skipped"):
            node.finished_at = _now()
        await db.commit()


async def _evaluate(db: AsyncSession, inp: NodeInput) -> NodeResult:
    ctx, cfg, t = inp.context, inp.config, inp.node_type
    org_id = uuid.UUID(inp.organization_id)
    if t == "condition.compare":
        path = f"variables.{cfg['variable']}" if cfg["field"] == "variables.value" else cfg["field"]
        value = resolve(ctx, path)
        ok = compare(value, cfg["operator"], cfg.get("value"))
        return NodeResult("true" if ok else "false", {"value": value, "result": ok})
    if t == "condition.keywords":
        text = (ctx.get("message") or {}).get("text")
        ok = keywords_match(text, cfg["keywords"], "any")
        return NodeResult("true" if ok else "false", {"text": text, "result": ok})
    if t == "condition.business_hours":
        tz = (ctx.get("org") or {}).get("timezone") or "UTC"
        ok = within_business_hours(_now(), tz, cfg["days"], cfg["start"], cfg["end"])
        return NodeResult("true" if ok else "false", {"timezone": tz, "open": ok})
    if t == "condition.has_tag":
        contact_id = (ctx.get("contact") or {}).get("id")
        has = bool(contact_id) and bool(await db.scalar(
            select(ContactTag.tag_id).where(ContactTag.contact_id == uuid.UUID(contact_id),
                                            ContactTag.tag_id == uuid.UUID(cfg["tag_id"]))
        ))  # fmt: skip
        return NodeResult("true" if has else "false", {"result": has})
    if t == "data.set_variable":
        value = render(cfg.get("value", ""), ctx, 1000)
        return NodeResult("out", {cfg["name"]: value}, {cfg["name"]: value})

    node_def = REGISTRY[t]
    if inp.test and node_def.side_effects:
        return NodeResult(None if not node_def.outputs else "out",
                          {"test": True, "description": actions.describe_test(t, ctx, cfg)})  # fmt: skip
    if t == "action.http_request":
        output = await actions.http_request(db, org_id, ctx, cfg)
        await db.commit()
        vars_to_add = {
            "http_status": str(output.get("status_code", "")),
            "http_body": str(output.get("body", "")),
        }
        return NodeResult("out", output, vars_to_add)
    if t == "action.send_message":
        output = await actions.send_message(db, org_id, inp.run_id, inp.node_id, ctx, cfg)
    else:
        output = await actions.ACTIONS[t](db, org_id, ctx, cfg)
        await db.commit()
    for key in ("conversation", "contact"):
        if (ctx.get(key) or {}).get("id"):
            await publish(org_id, f"{key}.updated", **{f"{key}_id": ctx[key]["id"]})
    return NodeResult("out" if node_def.outputs else None, output)


@activity.defn
async def execute_node(inp: NodeInput) -> NodeResult:
    async with org_session(inp.organization_id) as db:
        existing = await db.scalar(
            select(NodeRun).where(NodeRun.run_id == uuid.UUID(inp.run_id), NodeRun.node_id == inp.node_id)
        )
        if existing is not None and existing.status in ("completed", "skipped"):
            return NodeResult(existing.outcome, existing.output, existing.output.get("_variables", {}))
        if existing is None:
            existing = NodeRun(
                organization_id=uuid.UUID(inp.organization_id), run_id=uuid.UUID(inp.run_id), node_id=inp.node_id,
                node_type=inp.node_type, status="running", input={"config": inp.config}, started_at=_now(),
                created_at=_now(),
            )  # fmt: skip
            db.add(existing)
        else:
            existing.attempt = activity.info().attempt
            existing.status = "running"
        await db.commit()
        node_run_id = existing.id

    async with org_session(inp.organization_id) as db:
        status = "completed"
        try:
            result = await _evaluate(db, inp)
        except actions.StepSkipped as exc:
            node_def = REGISTRY[inp.node_type]
            result = NodeResult("out" if node_def.outputs else None, {"skipped": str(exc)})
            status = "skipped"
        except Exception as exc:
            await db.rollback()
            node = await db.get(NodeRun, node_run_id)
            if node:
                node.status = "failed"
                node.error = f"{type(exc).__name__}: {exc}"[:4000]
                node.finished_at = _now()
                await db.commit()
            raise

    async with org_session(inp.organization_id) as db:
        node = await db.get(NodeRun, node_run_id)
        if node:
            node.status = status
            node.outcome = result.outcome
            node.output = {**result.output, **({"_variables": result.variables} if result.variables else {})}
            node.finished_at = _now()
            await db.commit()
    return result


@activity.defn
async def create_approval(req: ApprovalRequest) -> str:
    async with org_session(req.organization_id) as db:
        existing = await db.scalar(
            select(Approval).where(Approval.run_id == uuid.UUID(req.run_id), Approval.node_id == req.node_id)
        )
        if existing:
            return str(existing.id)
        approval = Approval(
            id=uuid.uuid4(), organization_id=uuid.UUID(req.organization_id), run_id=uuid.UUID(req.run_id),
            node_id=req.node_id, title=req.title[:200], details=req.details,
            assignee_user_id=uuid.UUID(req.assignee_user_id) if req.assignee_user_id else None,
            expires_at=_now() + timedelta(hours=req.timeout_hours), created_at=_now(), updated_at=_now(),
        )  # fmt: skip
        db.add(approval)
        await db.commit()
        await publish(req.organization_id, "approval.updated", approval_id=approval.id)
        return str(approval.id)


@activity.defn
async def expire_approval(organization_id: str, approval_id: str) -> None:
    async with org_session(organization_id) as db:
        approval = await db.get(Approval, uuid.UUID(approval_id))
        if approval and approval.status == "pending":
            approval.status = "expired"
            approval.decided_at = _now()
            await db.commit()
            await publish(organization_id, "approval.updated", approval_id=approval.id)


@activity.defn
async def dispatch_schedule_activity(inp: dict[str, Any]) -> dict[str, Any]:
    from app.services.schedules import fire_schedule_from_activity

    return await fire_schedule_from_activity(inp["schedule_id"], inp.get("fire_key"))


ALL_ACTIVITIES: list[Callable[..., Any]] = [
    prepare_run,
    set_run_state,
    record_node,
    execute_node,
    create_approval,
    expire_approval,
    dispatch_schedule_activity,
]
