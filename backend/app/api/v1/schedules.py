import uuid

from fastapi import APIRouter, status

from app.api.deps import DB, OrgCtx
from app.schemas.schedules import ScheduleCreate, ScheduleOut, ScheduleUpdate
from app.services import schedules as svc

router = APIRouter(prefix="/organizations/{org_id}/schedules", tags=["schedules"])


@router.get("")
async def list_schedules(db: DB, ctx: OrgCtx) -> list[ScheduleOut]:
    ctx.require_any("schedules.manage", "workflows.read")
    return await svc.list_schedules(db, ctx.org_id)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_schedule(data: ScheduleCreate, db: DB, ctx: OrgCtx) -> ScheduleOut:
    ctx.require("schedules.manage")
    return await svc.create_schedule(db, ctx.org_id, ctx.user_id, data)


@router.get("/{schedule_id}")
async def get_schedule(schedule_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ScheduleOut:
    ctx.require_any("schedules.manage", "workflows.read")
    return await svc.get_schedule(db, ctx.org_id, schedule_id)


@router.patch("/{schedule_id}")
async def update_schedule(schedule_id: uuid.UUID, data: ScheduleUpdate, db: DB, ctx: OrgCtx) -> ScheduleOut:
    ctx.require("schedules.manage")
    return await svc.update_schedule(db, ctx.org_id, ctx.user_id, schedule_id, data)


@router.post("/{schedule_id}/pause")
async def pause_schedule(schedule_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ScheduleOut:
    ctx.require("schedules.manage")
    return await svc.pause_schedule(db, ctx.org_id, ctx.user_id, schedule_id)


@router.post("/{schedule_id}/resume")
async def resume_schedule(schedule_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ScheduleOut:
    ctx.require("schedules.manage")
    return await svc.resume_schedule(db, ctx.org_id, ctx.user_id, schedule_id)


@router.post("/{schedule_id}/trigger")
async def trigger_schedule_now(schedule_id: uuid.UUID, db: DB, ctx: OrgCtx) -> dict[str, int]:
    ctx.require("schedules.manage")
    started = await svc.trigger_schedule_now(db, ctx.org_id, ctx.user_id, schedule_id)
    return {"runs_started": started}


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(schedule_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    ctx.require("schedules.manage")
    await svc.delete_schedule(db, ctx.org_id, ctx.user_id, schedule_id)
