import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel

from app.api.deps import DB, OrgCtx
from app.schemas.common import Page
from app.schemas.crm import (
    ActivityCreate,
    ActivityOut,
    ConsentUpdate,
    ContactCreate,
    ContactDetail,
    ContactOut,
    ContactUpdate,
    CustomFieldCreate,
    CustomFieldOut,
    CustomFieldUpdate,
    LeadCreate,
    LeadOut,
    LeadUpdate,
    StageSummary,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from app.services import crm

router = APIRouter(prefix="/organizations/{org_id}", tags=["crm"])


# --- Custom fields -----------------------------------------------------------------------


@router.get("/custom-fields")
async def list_custom_fields(
    db: DB, ctx: OrgCtx, entity: Literal["contact", "lead"] | None = None, include_archived: bool = False
) -> list[CustomFieldOut]:
    fields = await crm.list_custom_fields(db, ctx, entity, include_archived)
    return [CustomFieldOut.model_validate(f) for f in fields]


@router.post("/custom-fields", status_code=status.HTTP_201_CREATED)
async def create_custom_field(data: CustomFieldCreate, db: DB, ctx: OrgCtx) -> CustomFieldOut:
    return CustomFieldOut.model_validate(await crm.create_custom_field(db, ctx, data.model_dump()))


@router.patch("/custom-fields/{field_id}")
async def update_custom_field(
    field_id: uuid.UUID, data: CustomFieldUpdate, db: DB, ctx: OrgCtx
) -> CustomFieldOut:
    changes = data.model_dump(exclude_unset=True)
    return CustomFieldOut.model_validate(await crm.update_custom_field(db, ctx, field_id, changes))


# --- Contacts ----------------------------------------------------------------------------


@router.get("/contacts")
async def list_contacts(
    db: DB,
    ctx: OrgCtx,
    q: Annotated[str | None, Query(max_length=100)] = None,
    tag_id: uuid.UUID | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page[ContactOut]:
    items, total = await crm.list_contacts(db, ctx, q or None, tag_id, page, page_size)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.post("/contacts", status_code=status.HTTP_201_CREATED)
async def create_contact(data: ContactCreate, db: DB, ctx: OrgCtx) -> ContactOut:
    return await crm.create_contact(db, ctx, data.model_dump())


@router.get("/contacts/{contact_id}")
async def get_contact(contact_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ContactDetail:
    return await crm.get_contact_detail(db, ctx, contact_id)


@router.patch("/contacts/{contact_id}")
async def update_contact(contact_id: uuid.UUID, data: ContactUpdate, db: DB, ctx: OrgCtx) -> ContactOut:
    return await crm.update_contact(db, ctx, contact_id, data.model_dump(exclude_unset=True))


@router.post("/contacts/{contact_id}/consent")
async def set_consent(contact_id: uuid.UUID, data: ConsentUpdate, db: DB, ctx: OrgCtx) -> ContactOut:
    return await crm.set_consent(db, ctx, contact_id, data.opted_out)


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(contact_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await crm.delete_contact(db, ctx, contact_id)


@router.get("/contacts/{contact_id}/activities")
async def list_activities(contact_id: uuid.UUID, db: DB, ctx: OrgCtx) -> list[ActivityOut]:
    return await crm.list_activities(db, ctx, contact_id)


@router.post("/contacts/{contact_id}/activities", status_code=status.HTTP_201_CREATED)
async def add_note(contact_id: uuid.UUID, data: ActivityCreate, db: DB, ctx: OrgCtx) -> list[ActivityOut]:
    await crm.add_contact_note(db, ctx, contact_id, data.body)
    return await crm.list_activities(db, ctx, contact_id)


# --- Leads -------------------------------------------------------------------------------


class LeadBoard(BaseModel):
    items: list[LeadOut]
    stages: list[StageSummary]


@router.get("/leads")
async def list_leads(
    db: DB,
    ctx: OrgCtx,
    stage: Literal["NEW", "QUALIFIED", "CONTACTED", "PROPOSAL", "NEGOTIATION", "CONVERTED", "LOST"]
    | None = None,
    owner: Literal["me", "unassigned"] | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    contact_id: uuid.UUID | None = None,
) -> LeadBoard:
    items, stages = await crm.list_leads(
        db, ctx, stage=stage, owner=owner, q=q or None, contact_id=contact_id
    )
    return LeadBoard(items=items, stages=stages)


@router.post("/leads", status_code=status.HTTP_201_CREATED)
async def create_lead(data: LeadCreate, db: DB, ctx: OrgCtx) -> LeadOut:
    return await crm.create_lead(db, ctx, data.model_dump())


@router.patch("/leads/{lead_id}")
async def update_lead(lead_id: uuid.UUID, data: LeadUpdate, db: DB, ctx: OrgCtx) -> LeadOut:
    return await crm.update_lead(db, ctx, lead_id, data.model_dump(exclude_unset=True))


@router.delete("/leads/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_lead(lead_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await crm.delete_lead(db, ctx, lead_id)


# --- Tasks -------------------------------------------------------------------------------


@router.get("/tasks")
async def list_tasks(
    db: DB,
    ctx: OrgCtx,
    scope: Literal["mine", "all"] = "all",
    status_filter: Annotated[Literal["open", "done", "all"], Query(alias="status")] = "open",
    due: Literal["overdue", "today", "upcoming"] | None = None,
    contact_id: uuid.UUID | None = None,
    lead_id: uuid.UUID | None = None,
    tz_offset: Annotated[int, Query(ge=-840, le=840, description="Viewer's UTC offset in minutes")] = 0,
) -> list[TaskOut]:
    return await crm.list_tasks(
        db, ctx, scope=scope, status=status_filter, due=due, contact_id=contact_id, lead_id=lead_id,
        tz_offset_minutes=tz_offset,
    )  # fmt: skip


@router.post("/tasks", status_code=status.HTTP_201_CREATED)
async def create_task(data: TaskCreate, db: DB, ctx: OrgCtx) -> TaskOut:
    return await crm.create_task(db, ctx, data.model_dump())


@router.patch("/tasks/{task_id}")
async def update_task(task_id: uuid.UUID, data: TaskUpdate, db: DB, ctx: OrgCtx) -> TaskOut:
    return await crm.update_task(db, ctx, task_id, data.model_dump(exclude_unset=True))


@router.delete("/tasks/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(task_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await crm.delete_task(db, ctx, task_id)
