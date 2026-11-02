"""Schedules service: timezone-aware recurring and one-off workflow automations."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
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


async def list_schedules(db: AsyncSession, org_id: uuid.UUID) -> list[ScheduleOut]:
    rows = await db.execute(
        select(Schedule, Workflow.name, Tag.name)
        .join(Workflow, Workflow.id == Schedule.workflow_id)
        .outerjoin(Tag, Tag.id == Schedule.target_tag_id)
        .where(Schedule.organization_id == org_id)
        .order_by(Schedule.created_at.desc())
    )
    res: list[ScheduleOut] = []
    for sched, wf_name, tag_name in rows.all():
        res.append(_to_out(sched, wf_name, tag_name))
    return res


async def get_schedule(db: AsyncSession, org_id: uuid.UUID, schedule_id: uuid.UUID) -> ScheduleOut:
    row = (
        await db.execute(
            select(Schedule, Workflow.name, Tag.name)
            .join(Workflow, Workflow.id == Schedule.workflow_id)
            .outerjoin(Tag, Tag.id == Schedule.target_tag_id)
            .where(Schedule.organization_id == org_id, Schedule.id == schedule_id)
        )
    ).first()
    if row is None:
        raise NotFoundError("Schedule not found", code="schedule_not_found")
    sched, wf_name, tag_name = row
    return _to_out(sched, wf_name, tag_name)


async def create_schedule(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    data: ScheduleCreate,
) -> ScheduleOut:
    workflow = await db.get(Workflow, data.workflow_id)
    if workflow is None or workflow.organization_id != org_id:
        raise NotFoundError("Workflow not found", code="workflow_not_found")

    tag_name: str | None = None
    if data.target_tag_id:
        tag = await db.get(Tag, data.target_tag_id)
        if tag is None or tag.organization_id != org_id:
            raise NotFoundError("Tag not found", code="tag_not_found")
        tag_name = tag.name

    org = await db.get(Organization, org_id)
    tz = data.timezone or (org.timezone if org else "UTC")

    schedule_id = uuid.uuid4()
    next_run = await engine.create_or_update_temporal_schedule(
        str(schedule_id),
        data.schedule_type,
        data.config,
        tz,
        paused=False,
    )

    now = datetime.now(UTC)
    sched = Schedule(
        id=schedule_id,
        organization_id=org_id,
        workflow_id=data.workflow_id,
        name=data.name,
        description=data.description,
        status="active",
        schedule_type=data.schedule_type,
        config=data.config,
        timezone=tz,
        target_tag_id=data.target_tag_id,
        temporal_schedule_id=engine.temporal_sched_id(str(schedule_id)),
        next_run_at=next_run,
        total_runs=0,
        created_by_user_id=user_id,
        created_at=now,
        updated_at=now,
    )
    db.add(sched)
    record_audit(
        db,
        "schedule.created",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
        details={"name": sched.name, "workflow_id": str(data.workflow_id)},
    )
    out = _to_out(sched, workflow.name, tag_name)
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return out


async def update_schedule(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
    data: ScheduleUpdate,
) -> ScheduleOut:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")

    workflow = await db.get(Workflow, sched.workflow_id)
    assert workflow is not None

    if data.name is not None:
        sched.name = data.name
    if data.description is not None:
        sched.description = data.description
    if data.schedule_type is not None:
        sched.schedule_type = data.schedule_type
    if data.config is not None:
        sched.config = data.config
    if data.timezone is not None:
        sched.timezone = data.timezone
    if data.target_tag_id is not None:
        if data.target_tag_id:
            tag = await db.get(Tag, data.target_tag_id)
            if tag is None or tag.organization_id != org_id:
                raise NotFoundError("Tag not found", code="tag_not_found")
        sched.target_tag_id = data.target_tag_id

    tag_name: str | None = None
    if sched.target_tag_id:
        tag_obj = await db.get(Tag, sched.target_tag_id)
        tag_name = tag_obj.name if tag_obj else None

    # Sync with Temporal
    next_run = await engine.create_or_update_temporal_schedule(
        str(sched.id),
        sched.schedule_type,
        sched.config,
        sched.timezone,
        paused=sched.status == "paused",
    )
    if next_run:
        sched.next_run_at = next_run
    sched.updated_at = datetime.now(UTC)

    record_audit(
        db,
        "schedule.updated",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
        details={"name": sched.name},
    )
    out = _to_out(sched, workflow.name, tag_name)
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return out


async def pause_schedule(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
) -> ScheduleOut:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")

    workflow = await db.get(Workflow, sched.workflow_id)
    tag_name: str | None = None
    if sched.target_tag_id:
        tag_obj = await db.get(Tag, sched.target_tag_id)
        tag_name = tag_obj.name if tag_obj else None

    sched.status = "paused"
    sched.updated_at = datetime.now(UTC)
    await engine.pause_temporal_schedule(str(sched.id))
    record_audit(
        db,
        "schedule.paused",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
    )
    out = _to_out(sched, workflow.name if workflow else "", tag_name)
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return out


async def resume_schedule(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
) -> ScheduleOut:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")

    workflow = await db.get(Workflow, sched.workflow_id)
    tag_name: str | None = None
    if sched.target_tag_id:
        tag_obj = await db.get(Tag, sched.target_tag_id)
        tag_name = tag_obj.name if tag_obj else None

    sched.status = "active"
    sched.updated_at = datetime.now(UTC)
    await engine.unpause_temporal_schedule(str(sched.id))
    record_audit(
        db,
        "schedule.resumed",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
    )
    out = _to_out(sched, workflow.name if workflow else "", tag_name)
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return out


async def delete_schedule(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
) -> None:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")

    await engine.delete_temporal_schedule(str(sched.id))
    record_audit(
        db,
        "schedule.deleted",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
        details={"name": sched.name},
    )
    await db.delete(sched)
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=schedule_id)


async def trigger_schedule_now(
    db: AsyncSession,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    schedule_id: uuid.UUID,
) -> int:
    sched = await db.get(Schedule, schedule_id)
    if sched is None or sched.organization_id != org_id:
        raise NotFoundError("Schedule not found", code="schedule_not_found")

    fire_time = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    started = await _dispatch_schedule_runs(db, sched, fire_time, user_id=user_id)
    record_audit(
        db,
        "schedule.triggered_manual",
        organization_id=org_id,
        actor_user_id=user_id,
        target_type="schedule",
        target_id=sched.id,
        details={"runs_started": started},
    )
    await db.commit()
    await publish(org_id, "schedule.updated", schedule_id=sched.id)
    return started


async def fire_schedule_from_activity(schedule_id: str) -> dict[str, Any]:
    """Invoked by the Temporal schedule activity when a recurring timer triggers."""
    async with SessionFactory() as db:
        sched = await db.get(Schedule, uuid.UUID(schedule_id))
        if sched is None:
            return {"ok": False, "error": "Schedule not found"}
        if sched.status != "active":
            return {"ok": True, "skipped": "Schedule is paused"}

        await set_rls_context(db, user_id=None, org_id=sched.organization_id)
        fire_time = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        started = await _dispatch_schedule_runs(db, sched, fire_time)
        await db.commit()
        await publish(sched.organization_id, "schedule.updated", schedule_id=sched.id)
        return {"ok": True, "runs_started": started}


async def _dispatch_schedule_runs(
    db: AsyncSession,
    sched: Schedule,
    fire_time: str,
    user_id: uuid.UUID | None = None,
) -> int:
    workflow = await db.get(Workflow, sched.workflow_id)
    if workflow is None or workflow.status != "active" or not workflow.published_version_id:
        log.warning(
            "schedule_workflow_not_active", schedule_id=str(sched.id), workflow_id=str(sched.workflow_id)
        )
        return 0

    version = await db.get(WorkflowVersion, workflow.published_version_id)
    if version is None:
        return 0

    started = 0
    if sched.target_tag_id:
        # Run per contact with the target tag (respecting opt-outs and soft deletes)
        contact_rows = await db.execute(
            select(Contact)
            .join(ContactTag, ContactTag.contact_id == Contact.id)
            .where(
                Contact.organization_id == sched.organization_id,
                Contact.deleted_at.is_(None),
                Contact.consent_status != "opted_out",
                ContactTag.tag_id == sched.target_tag_id,
            )
        )
        contacts = contact_rows.scalars().all()
        for contact in contacts:
            conv_id = await db.scalar(
                select(Conversation.id)
                .where(Conversation.contact_id == contact.id)
                .order_by(Conversation.created_at.desc())
                .limit(1)
            )
            event_key = f"sched:{sched.id}:{contact.id}:{fire_time}"
            run = await create_and_start(
                db,
                workflow=workflow,
                version=version,
                plan=version.compiled,
                trigger_type="trigger.schedule",
                payload={
                    "schedule_id": str(sched.id),
                    "schedule_name": sched.name,
                    "contact_id": str(contact.id),
                    "contact_name": contact.display_name,
                    "fire_time": fire_time,
                },
                event_key=event_key,
                conversation_id=conv_id,
                contact_id=contact.id,
                started_by=user_id,
            )
            if run:
                started += 1
    else:
        event_key = f"sched:{sched.id}:{fire_time}"
        run = await create_and_start(
            db,
            workflow=workflow,
            version=version,
            plan=version.compiled,
            trigger_type="trigger.schedule",
            payload={
                "schedule_id": str(sched.id),
                "schedule_name": sched.name,
                "fire_time": fire_time,
            },
            event_key=event_key,
            conversation_id=None,
            contact_id=None,
            started_by=user_id,
        )
        if run:
            started += 1

    sched.last_run_at = datetime.now(UTC)
    sched.total_runs += started
    return started


def _to_out(sched: Schedule, wf_name: str, tag_name: str | None) -> ScheduleOut:
    return ScheduleOut(
        id=sched.id,
        organization_id=sched.organization_id,
        workflow_id=sched.workflow_id,
        workflow_name=wf_name,
        name=sched.name,
        description=sched.description,
        status=sched.status,  # type: ignore[arg-type]
        schedule_type=sched.schedule_type,  # type: ignore[arg-type]
        config=sched.config,
        timezone=sched.timezone,
        target_tag_id=sched.target_tag_id,
        target_tag_name=tag_name,
        last_run_at=sched.last_run_at,
        next_run_at=sched.next_run_at,
        total_runs=sched.total_runs,
        created_at=sched.created_at,
        updated_at=sched.updated_at,
    )
