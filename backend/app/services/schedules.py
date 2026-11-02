"""Schedules service: timezone-aware recurring and one-off workflow automations.

A schedule points at a published workflow whose trigger is "On a schedule". Its timing lives here
(not in the workflow), and a matching Temporal schedule fires it; each fire starts one run, or one
run per contact with the target tag.
"""

import re
import uuid
from datetime import UTC, date, datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.database.session import SessionFactory, set_rls_context
from app.models import (
    Contact,
    ContactTag,
    Conversation,
    Organization,
    Schedule,
    Tag,
    Workflow,
    WorkflowVersion,
)
from app.schemas.schedules import ScheduleCreate, ScheduleOut, ScheduleUpdate
from app.services.audit import record_audit
from app.services.realtime import publish
from app.workflow_engine import client as engine
from app.workflow_engine.triggers import create_and_start

log = get_logger("services.schedules")

SCHEDULE_TRIGGER = "trigger.schedule"
MAX_SCHEDULES = 100
TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")
# Five standard cron fields; each a list of numbers, ranges, steps or "*" (no names or macros).
CRON_FIELD_RE = re.compile(r"^(\*|\d+(-\d+)?)(/\d+)?(,(\*|\d+(-\d+)?)(/\d+)?)*$")
CRON_LIMITS = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))


class InvalidScheduleError(AppError):
    status_code = 422
    code = "invalid_schedule"


def _validate_timezone(tz: str) -> str:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise InvalidScheduleError(f"Unknown timezone “{tz}”") from exc
    return tz


def _validate_cron(expr: str) -> str:
    fields = expr.split()
    if len(fields) != 5:
        raise InvalidScheduleError(
            "A cron expression needs 5 fields: minute hour day-of-month month day-of-week"
        )
    for field, (low, high) in zip(fields, CRON_LIMITS, strict=True):
        if not CRON_FIELD_RE.match(field):
            raise InvalidScheduleError(f"Unsupported cron field “{field}”")
        for n in re.findall(r"\d+", field.split("/")[0]):
            if not low <= int(n) <= high:
                raise InvalidScheduleError(f"Cron value {n} is out of range ({low}-{high})")
    return " ".join(fields)


def validate_config(schedule_type: str, config: dict[str, Any], tz: str) -> dict[str, Any]:
    """Returns the cleaned config for the schedule type (unknown keys are dropped)."""
    time = str(config.get("time") or "09:00")
    if not TIME_RE.match(time):
        raise InvalidScheduleError("Time must be HH:MM (24-hour)")
    clean: dict[str, Any] = {"time": time}
    if schedule_type == "weekly":
        days = [str(d).lower() for d in (config.get("days") or ["mon"])]
        if not days or any(d not in engine.DAY_NUMBERS for d in days):
            raise InvalidScheduleError("Choose at least one valid day of the week")
        clean["days"] = sorted(set(days), key=list(engine.DAY_NUMBERS).index)
    elif schedule_type == "monthly":
        try:
            dom = int(config.get("day_of_month") or 1)
        except (TypeError, ValueError) as exc:
            raise InvalidScheduleError("Day of month must be a number") from exc
        if not 1 <= dom <= 31:
            raise InvalidScheduleError("Day of month must be between 1 and 31")
        clean["day_of_month"] = dom
    elif schedule_type == "cron":
        clean = {"cron_expression": _validate_cron(str(config.get("cron_expression") or ""))}
    elif schedule_type == "once":
        try:
            day = date.fromisoformat(str(config.get("date") or ""))
        except ValueError as exc:
            raise InvalidScheduleError("A one-off schedule needs a date (YYYY-MM-DD)") from exc
        hour, minute = (int(p) for p in time.split(":"))
        when = datetime(day.year, day.month, day.day, hour, minute, tzinfo=ZoneInfo(tz))
        if when <= datetime.now(UTC):
            raise InvalidScheduleError("The date and time must be in the future")
        clean["date"] = day.isoformat()
    return clean


async def _schedulable_workflow(db: AsyncSession, org_id: uuid.UUID, workflow_id: uuid.UUID) -> Workflow:
    workflow = await db.get(Workflow, workflow_id)
    if workflow is None or workflow.organization_id != org_id:
        raise NotFoundError("Workflow not found", code="workflow_not_found")
    if workflow.trigger_type != SCHEDULE_TRIGGER or not workflow.published_version_id:
        raise InvalidScheduleError(
            "Only published workflows that start “On a schedule” can be scheduled",
            code="workflow_not_schedulable",
        )
    return workflow


async def _tag(db: AsyncSession, org_id: uuid.UUID, tag_id: uuid.UUID | None) -> Tag | None:
    if tag_id is None:
        return None
    tag = await db.get(Tag, tag_id)
    if tag is None or tag.organization_id != org_id:
        raise NotFoundError("Tag not found", code="tag_not_found")
    return tag


async def _get(db: AsyncSession, org_id: uuid.UUID, schedule_id: uuid.UUID) -> Schedule:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")
    return sched


async def _out(db: AsyncSession, sched: Schedule) -> ScheduleOut:
    workflow = await db.get(Workflow, sched.workflow_id)
    tag = await db.get(Tag, sched.target_tag_id) if sched.target_tag_id else None
    return _to_out(sched, workflow.name if workflow else "Deleted workflow", tag.name if tag else None)


async def list_schedules(db: AsyncSession, org_id: uuid.UUID) -> list[ScheduleOut]:
    rows = await db.execute(
        select(Schedule, Workflow.name, Tag.name)
        .join(Workflow, Workflow.id == Schedule.workflow_id)
        .outerjoin(Tag, Tag.id == Schedule.target_tag_id)
        .where(Schedule.organization_id == org_id)
        .order_by(Schedule.created_at.desc())
    )
    return [_to_out(sched, wf_name, tag_name) for sched, wf_name, tag_name in rows.all()]


async def get_schedule(db: AsyncSession, org_id: uuid.UUID, schedule_id: uuid.UUID) -> ScheduleOut:
    return await _out(db, await _get(db, org_id, schedule_id))


async def create_schedule(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, data: ScheduleCreate
) -> ScheduleOut:
    workflow = await _schedulable_workflow(db, org_id, data.workflow_id)
    await _tag(db, org_id, data.target_tag_id)
    count = await db.scalar(
        select(func.count()).select_from(Schedule).where(Schedule.organization_id == org_id)
    )
    if (count or 0) >= MAX_SCHEDULES:
        raise InvalidScheduleError(
            f"An organization can have at most {MAX_SCHEDULES} schedules", code="limit_reached"
        )
    org = await db.get(Organization, org_id)
    tz = _validate_timezone(data.timezone or (org.timezone if org else "UTC"))
    config = validate_config(data.schedule_type, data.config, tz)

    schedule_id = uuid.uuid4()
    # Engine first: if Temporal can't take it, nothing is saved (raises a 503).
    next_run = await engine.create_or_update_temporal_schedule(
        str(schedule_id), data.schedule_type, config, tz
    )
    sched = Schedule(
        id=schedule_id, organization_id=org_id, workflow_id=workflow.id, name=data.name,
        description=data.description, status="active", schedule_type=data.schedule_type, config=config,
        timezone=tz, target_tag_id=data.target_tag_id, temporal_schedule_id=engine.temporal_sched_id(str(schedule_id)),
        next_run_at=next_run, total_runs=0, created_by_user_id=user_id,
    )  # fmt: skip
    db.add(sched)
    try:
        await db.flush()
    except Exception:
        await engine.delete_temporal_schedule(str(schedule_id))
        raise
    record_audit(db, "schedule.created", organization_id=org_id, actor_user_id=user_id, target_type="schedule",
                 target_id=sched.id, details={"name": sched.name, "workflow_id": str(workflow.id)})  # fmt: skip
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return await _out(db, sched)


async def update_schedule(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID, data: ScheduleUpdate
) -> ScheduleOut:
    sched = await _get(db, org_id, schedule_id)
    fields = data.model_fields_set
    if data.name is not None:
        sched.name = data.name
    if "description" in fields:
        sched.description = data.description
    if "target_tag_id" in fields:  # null clears it
        await _tag(db, org_id, data.target_tag_id)
        sched.target_tag_id = data.target_tag_id
    schedule_type = data.schedule_type or sched.schedule_type
    tz = _validate_timezone(data.timezone or sched.timezone)
    timing_changed = bool(fields & {"schedule_type", "config", "timezone"})
    if timing_changed:
        config = validate_config(schedule_type, data.config if data.config is not None else sched.config, tz)
        sched.next_run_at = await engine.create_or_update_temporal_schedule(
            str(sched.id), schedule_type, config, tz, paused=sched.status == "paused"
        )
        sched.schedule_type, sched.config, sched.timezone = schedule_type, config, tz
    sched.updated_at = datetime.now(UTC)
    record_audit(db, "schedule.updated", organization_id=org_id, actor_user_id=user_id, target_type="schedule",
                 target_id=sched.id, details={"name": sched.name, "timing_changed": timing_changed})  # fmt: skip
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return await _out(db, sched)


async def _set_status(db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID,
                      status: str) -> ScheduleOut:  # fmt: skip
    sched = await _get(db, org_id, schedule_id)
    if sched.status != status:
        await engine.set_temporal_schedule_paused(str(sched.id), paused=status == "paused")
        sched.status = status
        sched.updated_at = datetime.now(UTC)
        record_audit(db, f"schedule.{'paused' if status == 'paused' else 'resumed'}", organization_id=org_id,
                     actor_user_id=user_id, target_type="schedule", target_id=sched.id)  # fmt: skip
        await db.commit()
        await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return await _out(db, sched)


async def pause_schedule(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID
) -> ScheduleOut:
    return await _set_status(db, org_id, user_id, schedule_id, "paused")


async def resume_schedule(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID
) -> ScheduleOut:
    return await _set_status(db, org_id, user_id, schedule_id, "active")


async def delete_schedule(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID
) -> None:
    sched = await _get(db, org_id, schedule_id)
    record_audit(db, "schedule.deleted", organization_id=org_id, actor_user_id=user_id, target_type="schedule",
                 target_id=sched.id, details={"name": sched.name})  # fmt: skip
    await db.delete(sched)
    await db.commit()
    await engine.delete_temporal_schedule(str(schedule_id))
    await publish(org_id, "schedule.updated", schedule_id=schedule_id)


async def trigger_schedule_now(
    db: AsyncSession, org_id: uuid.UUID, user_id: uuid.UUID, schedule_id: uuid.UUID
) -> int:
    sched = await _get(db, org_id, schedule_id)
    fire_key = f"manual:{datetime.now(UTC).strftime('%Y%m%dT%H%M%S.%fZ')}"
    started = await _dispatch_schedule_runs(db, sched, fire_key, user_id=user_id)
    record_audit(db, "schedule.triggered_manual", organization_id=org_id, actor_user_id=user_id,
                 target_type="schedule", target_id=sched.id, details={"runs_started": started})  # fmt: skip
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return started


async def fire_schedule_from_activity(schedule_id: str, fire_key: str | None = None) -> dict[str, Any]:
    """Called by the Temporal schedule activity on each fire. There is no tenant context yet, so the
    organization comes from a narrow owner-privileged lookup before RLS is engaged."""
    async with SessionFactory() as db:
        org_id = await db.scalar(text("SELECT schedule_org_by_id(:id)"), {"id": uuid.UUID(schedule_id)})
        if org_id is None:
            return {"ok": False, "error": "Schedule not found"}
        await set_rls_context(db, user_id=None, org_id=org_id)
        sched = await db.get(Schedule, uuid.UUID(schedule_id))
        if sched is None:
            return {"ok": False, "error": "Schedule not found"}
        if sched.status != "active":
            return {"ok": True, "skipped": "Schedule is paused"}
        key = fire_key or f"fire:{datetime.now(UTC).strftime('%Y%m%dT%H%M%SZ')}"
        started = await _dispatch_schedule_runs(db, sched, key)
        sched.next_run_at = await engine.next_fire_time(schedule_id)
        await db.commit()
        await publish(sched.organization_id, "schedule.updated", schedule_id=sched.id)
        return {"ok": True, "runs_started": started}


async def _dispatch_schedule_runs(
    db: AsyncSession, sched: Schedule, fire_key: str, user_id: uuid.UUID | None = None
) -> int:
    """Starts this fire's runs. Every run has a unique event key per fire (and contact), so a
    retried fire never starts a run twice."""
    workflow = await db.get(Workflow, sched.workflow_id)
    if workflow is None or workflow.status != "active" or not workflow.published_version_id:
        log.warning(
            "schedule_workflow_not_active", schedule_id=str(sched.id), workflow_id=str(sched.workflow_id)
        )
        return 0
    version = await db.get(WorkflowVersion, workflow.published_version_id)
    if version is None or version.compiled.get("trigger", {}).get("type") != SCHEDULE_TRIGGER:
        log.warning(
            "schedule_workflow_trigger_changed", schedule_id=str(sched.id), workflow_id=str(workflow.id)
        )
        return 0

    base_payload = {"schedule_id": str(sched.id), "schedule_name": sched.name, "fire_key": fire_key}
    targets: list[tuple[uuid.UUID | None, uuid.UUID | None]] = [(None, None)]
    if sched.target_tag_id:
        contact_ids = (
            await db.scalars(
                select(Contact.id)
                .join(ContactTag, ContactTag.contact_id == Contact.id)
                .where(Contact.deleted_at.is_(None), Contact.consent_status != "opted_out",
                       ContactTag.tag_id == sched.target_tag_id)
            )
        ).all()  # fmt: skip
        targets = []
        for contact_id in contact_ids:
            # The contact's most recent conversation, unless a team member has taken it over.
            conv = await db.scalar(
                select(Conversation).where(Conversation.contact_id == contact_id)
                .order_by(Conversation.last_message_at.desc().nulls_last(), Conversation.created_at.desc()).limit(1)
            )  # fmt: skip
            if conv is not None and conv.automation_paused:
                continue
            targets.append((contact_id, conv.id if conv else None))

    started = 0
    for target_contact, conversation_id in targets:
        run = await create_and_start(
            db, workflow=workflow, version=version, plan=version.compiled, trigger_type=SCHEDULE_TRIGGER,
            payload=base_payload, event_key=f"sched:{sched.id}:{fire_key}:{target_contact or '-'}"[:200],
            conversation_id=conversation_id, contact_id=target_contact, started_by=user_id,
        )  # fmt: skip
        if run:
            started += 1
    sched.last_run_at = datetime.now(UTC)
    sched.total_runs += started
    return started


def _to_out(sched: Schedule, wf_name: str, tag_name: str | None) -> ScheduleOut:
    return ScheduleOut(
        id=sched.id, organization_id=sched.organization_id, workflow_id=sched.workflow_id, workflow_name=wf_name,
        name=sched.name, description=sched.description, status=sched.status,
        schedule_type=sched.schedule_type,
        config=sched.config, timezone=sched.timezone, target_tag_id=sched.target_tag_id, target_tag_name=tag_name,
        last_run_at=sched.last_run_at, next_run_at=sched.next_run_at, total_runs=sched.total_runs,
        created_at=sched.created_at, updated_at=sched.updated_at,
    )  # fmt: skip
