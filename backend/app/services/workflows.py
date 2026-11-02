"""Workflows: drafts, validation, publishing (immutable versions), runs, approvals, webhooks."""

import json
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.models import (
    Approval,
    ChannelConnection,
    Contact,
    Conversation,
    NodeRun,
    OrganizationMember,
    Tag,
    Workflow,
    WorkflowRun,
    WorkflowVersion,
)
from app.models.automation import FINISHED_RUN_STATUSES
from app.schemas.workflows import (
    ApprovalOut,
    IssueOut,
    NodeRunOut,
    RunDetail,
    RunStats,
    RunSummary,
    ValidationOut,
    VersionOut,
    WorkflowOut,
    WorkflowSummary,
)
from app.services import plans
from app.services.audit import record_audit
from app.services.inbox import users_by_id
from app.services.organizations import OrgContext
from app.services.realtime import publish
from app.workflow_engine import client as engine
from app.workflow_engine.graph import Issue, ValidationResult, compile_definition, referenced_ids
from app.workflow_engine.triggers import create_and_start
from app.workflow_engine.types import ApprovalDecision

log = get_logger(__name__)

MAX_DEFINITION_BYTES = 256 * 1024


def _empty_definition() -> dict[str, Any]:
    return {"nodes": [], "edges": []}


async def _get(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> Workflow:
    wf = await db.scalar(
        select(Workflow).where(Workflow.id == workflow_id, Workflow.organization_id == ctx.org_id)
    )
    if wf is None:
        raise NotFoundError("Workflow not found")
    return wf


async def _stats(db: AsyncSession, workflow_ids: list[uuid.UUID]) -> dict[uuid.UUID, RunStats]:
    since = datetime.now(UTC) - timedelta(days=7)
    stats = {
        wid: RunStats(total_7d=0, failed_7d=0, last_status=None, last_run_at=None) for wid in workflow_ids
    }
    if not workflow_ids:
        return stats
    rows = await db.execute(
        select(
            WorkflowRun.workflow_id,
            func.count().filter(WorkflowRun.created_at >= since),
            func.count().filter(WorkflowRun.created_at >= since, WorkflowRun.status == "FAILED"),
            func.max(WorkflowRun.created_at),
        )
        .where(WorkflowRun.workflow_id.in_(workflow_ids), WorkflowRun.is_test.is_(False))
        .group_by(WorkflowRun.workflow_id)
    )
    for wid, total, failed, last in rows:
        stats[wid] = RunStats(total_7d=total, failed_7d=failed, last_status=None, last_run_at=last)
    last_rows = await db.execute(
        select(WorkflowRun.workflow_id, WorkflowRun.status)
        .where(WorkflowRun.workflow_id.in_(workflow_ids), WorkflowRun.is_test.is_(False))
        .distinct(WorkflowRun.workflow_id)
        .order_by(WorkflowRun.workflow_id, WorkflowRun.created_at.desc())
    )
    for wid, status in last_rows:
        stats[wid].last_status = status
    return stats


async def _version_numbers(
    db: AsyncSession, ids: list[uuid.UUID | None]
) -> dict[uuid.UUID, tuple[int, dict[str, Any]]]:
    wanted = [i for i in ids if i]
    if not wanted:
        return {}
    rows = await db.execute(select(WorkflowVersion.id, WorkflowVersion.version, WorkflowVersion.definition)
                            .where(WorkflowVersion.id.in_(wanted)))  # fmt: skip
    return {vid: (n, d) for vid, n, d in rows}


def _summary(
    wf: Workflow, versions: dict[uuid.UUID, tuple[int, dict[str, Any]]], stats: RunStats
) -> dict[str, Any]:
    published = versions.get(wf.published_version_id) if wf.published_version_id else None
    return {
        "id": wf.id,
        "name": wf.name,
        "description": wf.description,
        "status": wf.status,
        "trigger_type": wf.trigger_type,
        "published_version": published[0] if published else None,
        "has_unpublished_changes": published is None or _strip(published[1]) != _strip(wf.draft_definition),
        "stats": stats,
        "updated_at": wf.updated_at,
    }


def _strip(definition: dict[str, Any]) -> str:
    """Comparable form of a definition: positions and viewport don't count as changes."""
    nodes = [{"id": n.get("id"), "data": n.get("data")} for n in definition.get("nodes", [])]
    edges = sorted(
        (str(e.get("source")), str(e.get("sourceHandle") or "out"), str(e.get("target")))
        for e in definition.get("edges", [])
    )
    return json.dumps({"nodes": sorted(nodes, key=lambda n: str(n["id"])), "edges": edges}, sort_keys=True)


def webhook_url(wf: Workflow) -> str | None:
    if not wf.webhook_token:
        return None
    return f"{get_settings().public_api_url.rstrip('/')}/api/v1/hooks/{wf.webhook_token}"


async def list_workflows(
    db: AsyncSession, ctx: OrgContext, include_archived: bool = False
) -> list[WorkflowSummary]:
    ctx.require("workflows.read")
    stmt = select(Workflow).where(Workflow.organization_id == ctx.org_id)
    if not include_archived:
        stmt = stmt.where(Workflow.status != "archived")
    workflows = list((await db.scalars(stmt.order_by(Workflow.updated_at.desc()))).all())
    versions = await _version_numbers(db, [w.published_version_id for w in workflows])
    stats = await _stats(db, [w.id for w in workflows])
    return [WorkflowSummary(**_summary(w, versions, stats[w.id])) for w in workflows]


async def get_workflow(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> WorkflowOut:
    ctx.require("workflows.read")
    wf = await _get(db, ctx, workflow_id)
    versions = await _version_numbers(db, [wf.published_version_id])
    stats = await _stats(db, [wf.id])
    return WorkflowOut(
        **_summary(wf, versions, stats[wf.id]),
        definition=wf.draft_definition or _empty_definition(),
        # The URL contains the secret: only people who may publish see it.
        webhook_url=webhook_url(wf) if "workflows.publish" in ctx.permissions else None,
    )


def _check_size(definition: dict[str, Any]) -> None:
    if len(json.dumps(definition)) > MAX_DEFINITION_BYTES:
        raise AppError("The workflow is too large", code="workflow_too_large")


async def create_workflow(db: AsyncSession, ctx: OrgContext, name: str, description: str | None,
                          definition: dict[str, Any] | None) -> WorkflowOut:  # fmt: skip
    ctx.require("workflows.manage")
    definition = definition or _empty_definition()
    _check_size(definition)
    count = await db.scalar(
        select(func.count()).select_from(Workflow)
        .where(Workflow.organization_id == ctx.org_id, Workflow.status != "archived")
    )  # fmt: skip
    if (count or 0) >= 200:
        raise AppError("An organization can have at most 200 workflows", code="workflow_limit")
    now = datetime.now(UTC)
    wf = Workflow(id=uuid.uuid4(), organization_id=ctx.org_id, name=name, description=description,
                  draft_definition=definition, created_by_user_id=ctx.user.id, created_at=now, updated_at=now)  # fmt: skip
    db.add(wf)
    record_audit(db, "workflow.created", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="workflow", target_id=wf.id, details={"name": name})  # fmt: skip
    await db.commit()
    return await get_workflow(db, ctx, wf.id)


async def update_workflow(
    db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID, changes: dict[str, Any]
) -> WorkflowOut:
    ctx.require("workflows.manage")
    wf = await _get(db, ctx, workflow_id)
    if wf.status == "archived":
        raise ConflictError("Restore the workflow before editing it", code="workflow_archived")
    if "definition" in changes and changes["definition"] is not None:
        _check_size(changes["definition"])
        wf.draft_definition = changes.pop("definition")
    for key in ("name", "description"):
        if key in changes and changes[key] is not None:
            setattr(wf, key, changes[key])
    await db.commit()
    return await get_workflow(db, ctx, workflow_id)


async def _validate_refs(db: AsyncSession, ctx: OrgContext, result: ValidationResult) -> None:
    """Settings may point at tags, people or channels that no longer exist."""
    if not result.plan:
        return
    refs = referenced_ids(result.plan)

    def as_uuids(values: set[str]) -> set[uuid.UUID]:
        out = set()
        for v in values:
            try:
                out.add(uuid.UUID(v))
            except ValueError:
                result.errors.append(_issue("A step refers to something that doesn't exist"))
        return out

    tags = as_uuids(refs["tag"])
    if tags and len(
        (await db.scalars(select(Tag.id).where(Tag.id.in_(tags), Tag.organization_id == ctx.org_id))).all()
    ) != len(tags):
        result.errors.append(_issue("A step uses a tag that was deleted"))
    users = as_uuids(refs["user"])
    if users:
        found = (await db.scalars(select(OrganizationMember.user_id).where(
            OrganizationMember.organization_id == ctx.org_id, OrganizationMember.user_id.in_(users),
            OrganizationMember.status == "active"))).all()  # fmt: skip
        if len(found) != len(users):
            result.errors.append(_issue("A step refers to a person who is no longer a member"))
    conns = as_uuids(refs["connection"])
    if conns:
        found = (await db.scalars(select(ChannelConnection.id).where(
            ChannelConnection.id.in_(conns), ChannelConnection.organization_id == ctx.org_id,
            ChannelConnection.deleted_at.is_(None)))).all()  # fmt: skip
        if len(found) != len(conns):
            result.errors.append(_issue("The trigger uses a channel that was removed"))
    if result.errors:
        result.plan = None


def _issue(message: str, node_id: str | None = None) -> Issue:
    return Issue(message, node_id)


def _validation_out(result: ValidationResult) -> ValidationOut:
    return ValidationOut(
        ok=result.ok,
        errors=[IssueOut(message=i.message, node_id=i.node_id) for i in result.errors],
        warnings=[IssueOut(message=i.message, node_id=i.node_id) for i in result.warnings],
    )


async def validate(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> ValidationOut:
    ctx.require("workflows.read")
    wf = await _get(db, ctx, workflow_id)
    result = compile_definition(wf.draft_definition)
    await _validate_refs(db, ctx, result)
    return _validation_out(result)


async def publish_workflow(
    db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID
) -> tuple[WorkflowOut, ValidationOut]:
    """Validates and compiles the draft into a new immutable version and activates it.
    Runs already in progress keep executing the version they started with."""
    ctx.require("workflows.publish")
    wf = await _get(db, ctx, workflow_id)
    result = compile_definition(wf.draft_definition)
    await _validate_refs(db, ctx, result)
    validation = _validation_out(result)
    if not result.ok or result.plan is None:
        return await get_workflow(db, ctx, workflow_id), validation
    current = await db.scalar(
        select(func.max(WorkflowVersion.version)).where(WorkflowVersion.workflow_id == wf.id)
    )
    version = WorkflowVersion(
        id=uuid.uuid4(), organization_id=ctx.org_id, workflow_id=wf.id, version=(current or 0) + 1,
        definition=wf.draft_definition, compiled=result.plan, published_by_user_id=ctx.user.id,
        created_at=datetime.now(UTC),
    )  # fmt: skip
    db.add(version)
    await db.flush()
    wf.published_version_id = version.id
    wf.trigger_type = result.plan["trigger"]["type"]
    wf.status = "active"
    if wf.trigger_type == "trigger.webhook" and not wf.webhook_token:
        wf.webhook_token = secrets.token_urlsafe(32)
    record_audit(db, "workflow.published", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="workflow", target_id=wf.id, details={"version": version.version})  # fmt: skip
    await db.commit()
    return await get_workflow(db, ctx, workflow_id), validation


async def set_status(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID, status: str) -> WorkflowOut:
    ctx.require("workflows.publish")
    wf = await _get(db, ctx, workflow_id)
    if status == "active":
        ctx.require_not_suspended()
        if not wf.published_version_id:
            raise ConflictError("Publish the workflow before activating it", code="not_published")
        await plans.check_resource_limit(db, ctx.org_id, "max_workflows")
    wf.status = status
    record_audit(db, f"workflow.{status}", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="workflow", target_id=wf.id)  # fmt: skip
    await db.commit()
    return await get_workflow(db, ctx, workflow_id)


async def regenerate_webhook(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> WorkflowOut:
    ctx.require("workflows.publish")
    wf = await _get(db, ctx, workflow_id)
    if wf.trigger_type != "trigger.webhook":
        raise AppError("This workflow isn't started by a webhook", code="not_webhook")
    wf.webhook_token = secrets.token_urlsafe(32)
    record_audit(db, "workflow.webhook_regenerated", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="workflow", target_id=wf.id)  # fmt: skip
    await db.commit()
    return await get_workflow(db, ctx, workflow_id)


async def duplicate(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> WorkflowOut:
    wf = await _get(db, ctx, workflow_id)
    return await create_workflow(db, ctx, f"Copy of {wf.name}"[:120], wf.description, wf.draft_definition)


async def list_versions(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID) -> list[VersionOut]:
    ctx.require("workflows.read")
    wf = await _get(db, ctx, workflow_id)
    rows = list((await db.scalars(select(WorkflowVersion).where(WorkflowVersion.workflow_id == wf.id)
                                  .order_by(WorkflowVersion.version.desc()))).all())  # fmt: skip
    users = await users_by_id(db, (v.published_by_user_id for v in rows))
    return [
        VersionOut(id=v.id, version=v.version, created_at=v.created_at, is_current=v.id == wf.published_version_id,
                   published_by=users[v.published_by_user_id].full_name if v.published_by_user_id in users else None)
        for v in rows
    ]  # fmt: skip


async def restore_version(
    db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID, version_id: uuid.UUID
) -> WorkflowOut:
    """Loads an old version into the draft (publish again to make it live)."""
    ctx.require("workflows.manage")
    wf = await _get(db, ctx, workflow_id)
    version = await db.scalar(select(WorkflowVersion).where(WorkflowVersion.id == version_id,
                                                            WorkflowVersion.workflow_id == wf.id))  # fmt: skip
    if version is None:
        raise NotFoundError("Version not found")
    wf.draft_definition = version.definition
    await db.commit()
    return await get_workflow(db, ctx, workflow_id)


# --- Runs ----------------------------------------------------------------------------------


async def _conversation_for_run(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID | None
) -> Conversation | None:
    if conversation_id is None:
        return None
    conv = await db.scalar(select(Conversation).where(Conversation.id == conversation_id,
                                                      Conversation.organization_id == ctx.org_id))  # fmt: skip
    if conv is None:
        raise NotFoundError("Conversation not found")
    return conv


async def start_test_run(db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID, conversation_id: uuid.UUID | None,
                         sample_message: str | None, webhook: dict[str, Any] | None) -> tuple[RunSummary | None, ValidationOut]:  # fmt: skip
    """Runs the current draft without side effects: actions describe what they would do,
    waits and delays are skipped. Safe to use on real conversations."""
    ctx.require("workflows.manage")
    wf = await _get(db, ctx, workflow_id)
    result = compile_definition(wf.draft_definition)
    await _validate_refs(db, ctx, result)
    validation = _validation_out(result)
    if result.plan is None:
        return None, validation
    conv = await _conversation_for_run(db, ctx, conversation_id)
    run = await create_and_start(
        db, workflow=wf, version=None, plan=result.plan, trigger_type=result.plan["trigger"]["type"],
        payload={"message_text": sample_message, "webhook": webhook or {}}, event_key=None,
        conversation_id=conv.id if conv else None, contact_id=conv.contact_id if conv else None,
        is_test=True, started_by=ctx.user.id,
    )  # fmt: skip
    assert run is not None
    return (await _run_summaries(db, [run]))[0], validation


async def start_manual_run(
    db: AsyncSession, ctx: OrgContext, workflow_id: uuid.UUID, conversation_id: uuid.UUID | None
) -> RunSummary:
    ctx.require("workflows.manage")
    wf = await _get(db, ctx, workflow_id)
    if wf.trigger_type != "trigger.manual" or not wf.published_version_id:
        raise ConflictError(
            "Only published workflows with a Manual trigger can be started by hand", code="not_manual"
        )
    if wf.status != "active":
        raise ConflictError("Activate the workflow first", code="workflow_inactive")
    version = await db.get(WorkflowVersion, wf.published_version_id)
    assert version is not None
    conv = await _conversation_for_run(db, ctx, conversation_id)
    if conv is not None and conv.automation_paused:
        raise ConflictError("A team member has taken over this conversation", code="human_takeover")
    run = await create_and_start(
        db, workflow=wf, version=version, plan=version.compiled, trigger_type="trigger.manual", payload={},
        event_key=None, conversation_id=conv.id if conv else None, contact_id=conv.contact_id if conv else None,
        started_by=ctx.user.id,
    )  # fmt: skip
    assert run is not None
    return (await _run_summaries(db, [run]))[0]


async def _run_summaries(db: AsyncSession, runs: list[WorkflowRun]) -> list[RunSummary]:
    if not runs:
        return []
    ids = [r.id for r in runs]
    wf_names = {i: n for i, n in await db.execute(select(Workflow.id, Workflow.name)
                                                  .where(Workflow.id.in_({r.workflow_id for r in runs})))}  # fmt: skip
    versions = {i: n for i, n in await db.execute(select(WorkflowVersion.id, WorkflowVersion.version)
                                                  .where(WorkflowVersion.id.in_({r.version_id for r in runs if r.version_id})))}  # fmt: skip
    contacts = {i: n for i, n in await db.execute(select(Contact.id, Contact.display_name)
                                                  .where(Contact.id.in_({r.contact_id for r in runs if r.contact_id})))}  # fmt: skip
    node_stats = {
        rid: (total, failed, retries)
        for rid, total, failed, retries in await db.execute(
            select(NodeRun.run_id, func.count(), func.count().filter(NodeRun.status == "failed"),
                   func.coalesce(func.sum(NodeRun.attempt - 1), 0))
            .where(NodeRun.run_id.in_(ids)).group_by(NodeRun.run_id)
        )
    }  # fmt: skip
    out = []
    for r in runs:
        total, failed, retries = node_stats.get(r.id, (0, 0, 0))
        duration = None
        if r.started_at:
            end = r.finished_at or (
                datetime.now(UTC) if r.status not in FINISHED_RUN_STATUSES else r.started_at
            )
            duration = int((end - r.started_at).total_seconds() * 1000)
        out.append(RunSummary(
            id=r.id, workflow_id=r.workflow_id, workflow_name=wf_names.get(r.workflow_id, "Deleted workflow"),
            version=versions.get(r.version_id) if r.version_id else None, status=r.status, is_test=r.is_test,
            trigger_type=r.trigger_type, conversation_id=r.conversation_id,
            contact_name=contacts.get(r.contact_id) if r.contact_id else None, waiting_for=r.waiting_for,
            error=r.error, started_at=r.started_at, finished_at=r.finished_at, created_at=r.created_at,
            duration_ms=duration, node_count=total, failed_nodes=failed, retries=int(retries),
        ))  # fmt: skip
    return out


async def list_runs(db: AsyncSession, ctx: OrgContext, *, workflow_id: uuid.UUID | None, status: str | None,
                    include_tests: bool, page: int, page_size: int) -> tuple[list[RunSummary], int]:  # fmt: skip
    ctx.require("executions.read")
    where = [WorkflowRun.organization_id == ctx.org_id]
    if workflow_id:
        where.append(WorkflowRun.workflow_id == workflow_id)
    if status:
        where.append(WorkflowRun.status == status)
    if not include_tests:
        where.append(WorkflowRun.is_test.is_(False))
    total = await db.scalar(select(func.count()).select_from(WorkflowRun).where(*where)) or 0
    runs = list((await db.scalars(select(WorkflowRun).where(*where).order_by(WorkflowRun.created_at.desc())
                                  .offset((page - 1) * page_size).limit(page_size))).all())  # fmt: skip
    return await _run_summaries(db, runs), total


async def _get_run(db: AsyncSession, ctx: OrgContext, run_id: uuid.UUID) -> WorkflowRun:
    run = await db.scalar(
        select(WorkflowRun).where(WorkflowRun.id == run_id, WorkflowRun.organization_id == ctx.org_id)
    )
    if run is None:
        raise NotFoundError("Run not found")
    return run


def _mask(value: Any) -> Any:
    """Never show secrets in execution logs, even if someone put one in a variable or webhook body."""
    sensitive = ("password", "secret", "token", "api_key", "apikey", "authorization", "card", "otp")
    if isinstance(value, dict):
        return {k: "***" if any(s in k.lower() for s in sensitive) else _mask(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_mask(v) for v in value]
    return value


async def get_run(db: AsyncSession, ctx: OrgContext, run_id: uuid.UUID) -> RunDetail:
    ctx.require("executions.read")
    run = await _get_run(db, ctx, run_id)
    summary = (await _run_summaries(db, [run]))[0]
    nodes = list((await db.scalars(select(NodeRun).where(NodeRun.run_id == run.id)
                                   .order_by(NodeRun.started_at, NodeRun.created_at))).all())  # fmt: skip
    definition = None
    if run.version_id:
        version = await db.get(WorkflowVersion, run.version_id)
        definition = version.definition if version else None
    else:
        wf = await db.get(Workflow, run.workflow_id)
        definition = wf.draft_definition if wf else None
    return RunDetail(
        **summary.model_dump(),
        trigger_payload=_mask(run.trigger_payload),
        retry_of_run_id=run.retry_of_run_id,
        definition=definition,
        nodes=[NodeRunOut(node_id=n.node_id, node_type=n.node_type, status=n.status, attempt=n.attempt,
                          outcome=n.outcome, input=_mask(n.input), output=_mask(n.output), error=n.error,
                          started_at=n.started_at, finished_at=n.finished_at) for n in nodes],
    )  # fmt: skip


async def retry_run(db: AsyncSession, ctx: OrgContext, run_id: uuid.UUID) -> RunSummary:
    """Starts a new run with the same version and trigger data. Steps that send messages use new
    idempotency keys, so only runs that did not complete may be retried."""
    ctx.require("executions.manage")
    run = await _get_run(db, ctx, run_id)
    if run.status not in ("FAILED", "CANCELLED", "TIMED_OUT"):
        raise ConflictError("Only failed, cancelled or timed-out runs can be retried", code="not_retryable")
    wf = await db.get(Workflow, run.workflow_id)
    if wf is None:
        raise NotFoundError("Workflow not found")
    if run.is_test or run.version_id is None:
        raise ConflictError("Test runs can't be retried; start a new test instead", code="not_retryable")
    version = await db.get(WorkflowVersion, run.version_id)
    assert version is not None
    new = await create_and_start(
        db, workflow=wf, version=version, plan=version.compiled, trigger_type=run.trigger_type,
        payload=run.trigger_payload, event_key=None, conversation_id=run.conversation_id, contact_id=run.contact_id,
        started_by=ctx.user.id, retry_of=run.id,
    )  # fmt: skip
    assert new is not None
    return (await _run_summaries(db, [new]))[0]


async def cancel_run(db: AsyncSession, ctx: OrgContext, run_id: uuid.UUID) -> RunSummary:
    ctx.require("executions.manage")
    run = await _get_run(db, ctx, run_id)
    if run.status in FINISHED_RUN_STATUSES:
        raise ConflictError("This run has already finished", code="run_finished")
    try:
        await engine.cancel(str(run.id))
    except Exception as exc:
        # Not running in the engine (e.g. never started): record the cancellation directly.
        log.warning("cancel_fallback", run_id=str(run.id), error=str(exc))
        run.status = "CANCELLED"
        run.finished_at = datetime.now(UTC)
        run.error = "Cancelled by a team member"
        await db.execute(
            update(NodeRun)
            .where(NodeRun.run_id == run.id, NodeRun.status.in_(("running", "waiting")))
            .values(status="cancelled", finished_at=run.finished_at)
        )
    await db.execute(
        update(Approval)
        .where(Approval.run_id == run.id, Approval.status == "pending")
        .values(status="cancelled", decided_at=datetime.now(UTC))
    )
    record_audit(db, "workflow.run_cancelled", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="workflow_run", target_id=run.id)  # fmt: skip
    await db.commit()
    await publish(ctx.org_id, "run.updated", run_id=run.id)
    return (await _run_summaries(db, [run]))[0]


# --- Approvals -----------------------------------------------------------------------------


async def list_approvals(db: AsyncSession, ctx: OrgContext, status: str | None) -> list[ApprovalOut]:
    ctx.require("executions.read")
    stmt = select(Approval).where(Approval.organization_id == ctx.org_id)
    if status:
        stmt = stmt.where(Approval.status == status)
    approvals = list((await db.scalars(stmt.order_by(Approval.created_at.desc()).limit(200))).all())
    runs = (
        {
            r.id: r
            for r in (
                await db.scalars(select(WorkflowRun).where(WorkflowRun.id.in_({a.run_id for a in approvals})))
            ).all()
        }
        if approvals
        else {}
    )
    names = {i: n for i, n in await db.execute(select(Workflow.id, Workflow.name).where(
        Workflow.id.in_({r.workflow_id for r in runs.values()})))} if runs else {}  # fmt: skip
    users = await users_by_id(
        db, [a.assignee_user_id for a in approvals] + [a.decided_by_user_id for a in approvals]
    )
    return [
        ApprovalOut(
            id=a.id, run_id=a.run_id, workflow_name=names.get(runs[a.run_id].workflow_id, "") if a.run_id in runs else "",
            title=a.title, details=a.details, status=a.status,
            assignee=users[a.assignee_user_id].full_name if a.assignee_user_id in users else None,
            decided_by=users[a.decided_by_user_id].full_name if a.decided_by_user_id in users else None,
            decided_at=a.decided_at, decision_note=a.decision_note, expires_at=a.expires_at, created_at=a.created_at,
        )
        for a in approvals
    ]  # fmt: skip


async def decide_approval(
    db: AsyncSession, ctx: OrgContext, approval_id: uuid.UUID, decision: str, note: str | None
) -> ApprovalOut:
    ctx.require("approvals.decide")
    approval = await db.scalar(select(Approval).where(Approval.id == approval_id, Approval.organization_id == ctx.org_id)
                               .with_for_update())  # fmt: skip
    if approval is None:
        raise NotFoundError("Approval not found")
    if approval.status != "pending":
        raise ConflictError(f"This request is already {approval.status}", code="approval_closed")
    approval.status = decision
    approval.decided_by_user_id = ctx.user.id
    approval.decided_at = datetime.now(UTC)
    approval.decision_note = note
    record_audit(db, f"approval.{decision}", organization_id=ctx.org_id, actor_user_id=ctx.user.id,
                 target_type="approval", target_id=approval.id, details={"title": approval.title})  # fmt: skip
    await db.commit()
    try:
        await engine.signal_approval(
            str(approval.run_id), ApprovalDecision(str(approval.id), decision, str(ctx.user.id))
        )
    except Exception as exc:
        log.error("approval_signal_failed", approval_id=str(approval.id), error=str(exc))
        raise AppError("Decision saved, but the workflow could not be resumed. Try again shortly.",
                       code="workflow_engine_unavailable") from exc  # fmt: skip
    await publish(ctx.org_id, "approval.updated", approval_id=approval.id)
    return next(a for a in await list_approvals(db, ctx, None) if a.id == approval.id)
