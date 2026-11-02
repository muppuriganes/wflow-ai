"""Contacts, custom fields, leads, follow-up tasks and the customer timeline."""

import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, NotFoundError
from app.models import (
    ChannelConnection,
    Contact,
    ContactTag,
    Conversation,
    CustomerActivity,
    CustomFieldDefinition,
    FollowUpTask,
    Lead,
    OrganizationMember,
)
from app.models.crm import CLOSED_STAGES, LEAD_STAGES
from app.schemas.crm import (
    ActivityOut,
    ContactConversationRef,
    ContactDetail,
    ContactOut,
    LeadContact,
    LeadOut,
    StageSummary,
    TaskOut,
    TaskRef,
)
from app.services import webhooks
from app.services.inbox import like_pattern, tags_for_contacts, users_by_id
from app.services.organizations import OrgContext
from app.services.realtime import publish

# --- Custom fields ---------------------------------------------------------------------


async def list_custom_fields(
    db: AsyncSession, ctx: OrgContext, entity: str | None = None, include_archived: bool = False
) -> list[CustomFieldDefinition]:
    ctx.require("contacts.read")
    stmt = select(CustomFieldDefinition).where(CustomFieldDefinition.organization_id == ctx.org_id)
    if entity:
        stmt = stmt.where(CustomFieldDefinition.entity == entity)
    if not include_archived:
        stmt = stmt.where(CustomFieldDefinition.archived.is_(False))
    return list(
        (await db.scalars(stmt.order_by(CustomFieldDefinition.position, CustomFieldDefinition.label))).all()
    )


async def create_custom_field(
    db: AsyncSession, ctx: OrgContext, data: dict[str, Any]
) -> CustomFieldDefinition:
    ctx.require("org.update")
    if data["field_type"] == "select" and not data.get("options"):
        raise AppError("A list field needs at least one option", code="options_required")
    exists = await db.scalar(
        select(CustomFieldDefinition.id).where(
            CustomFieldDefinition.organization_id == ctx.org_id,
            CustomFieldDefinition.entity == data["entity"],
            CustomFieldDefinition.key == data["key"],
        )
    )
    if exists:
        raise ConflictError("A field with this key already exists", code="field_exists")
    count = await db.scalar(
        select(func.count())
        .select_from(CustomFieldDefinition)
        .where(CustomFieldDefinition.organization_id == ctx.org_id)
    )
    if (count or 0) >= 50:
        raise AppError("An organization can define at most 50 custom fields", code="field_limit")
    field = CustomFieldDefinition(
        organization_id=ctx.org_id, position=count or 0, created_at=datetime.now(UTC), **data
    )
    db.add(field)
    await db.commit()
    return field


async def update_custom_field(
    db: AsyncSession, ctx: OrgContext, field_id: uuid.UUID, changes: dict[str, Any]
) -> CustomFieldDefinition:
    ctx.require("org.update")
    field = await db.scalar(
        select(CustomFieldDefinition).where(
            CustomFieldDefinition.id == field_id, CustomFieldDefinition.organization_id == ctx.org_id
        )
    )
    if field is None:
        raise NotFoundError("Field not found")
    for key, value in changes.items():
        setattr(field, key, value)
    await db.commit()
    return field


def _coerce(field: CustomFieldDefinition, value: Any) -> Any:
    if value is None or value == "":
        return None
    match field.field_type:
        case "text":
            text = str(value).strip()
            if len(text) > 500:
                raise AppError(f"{field.label}: at most 500 characters", code="invalid_custom_field")
            return text
        case "number":
            try:
                number = Decimal(str(value))
            except InvalidOperation as exc:
                raise AppError(f"{field.label}: enter a number", code="invalid_custom_field") from exc
            return float(number) if number % 1 else int(number)
        case "date":
            try:
                return date.fromisoformat(str(value)).isoformat()
            except ValueError as exc:
                raise AppError(f"{field.label}: use YYYY-MM-DD", code="invalid_custom_field") from exc
        case "select":
            if str(value) not in field.options:
                raise AppError(
                    f"{field.label}: choose one of the listed options", code="invalid_custom_field"
                )
            return str(value)
        case "boolean":
            if isinstance(value, bool):
                return value
            raise AppError(f"{field.label}: must be true or false", code="invalid_custom_field")
    raise AppError(f"{field.label}: unsupported field", code="invalid_custom_field")


async def validate_custom_fields(
    db: AsyncSession, ctx: OrgContext, entity: str, values: dict[str, Any], existing: dict[str, Any] | None
) -> dict[str, Any]:
    """Unknown keys are rejected, values coerced per type, required fields enforced on the result."""
    fields = {f.key: f for f in await list_custom_fields(db, ctx, entity)}
    unknown = set(values) - set(fields)
    if unknown:
        raise AppError(f"Unknown field: {sorted(unknown)[0]}", code="invalid_custom_field")
    result = dict(existing or {})
    for key, value in values.items():
        coerced = _coerce(fields[key], value)
        if coerced is None:
            result.pop(key, None)
        else:
            result[key] = coerced
    missing = [f.label for f in fields.values() if f.required and f.key not in result]
    if missing:
        raise AppError(f"{missing[0]} is required", code="custom_field_required")
    return result


# --- Shared helpers ----------------------------------------------------------------------


async def _record(
    db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, activity_type: str, summary: str,
    lead_id: uuid.UUID | None = None, details: dict[str, Any] | None = None,
) -> None:  # fmt: skip
    db.add(
        CustomerActivity(
            organization_id=ctx.org_id, contact_id=contact_id, lead_id=lead_id, actor_user_id=ctx.user.id,
            activity_type=activity_type, summary=summary, details=details or {}, created_at=datetime.now(UTC),
        )
    )  # fmt: skip


async def _ensure_member(db: AsyncSession, ctx: OrgContext, user_id: uuid.UUID | None) -> None:
    if user_id is None:
        return
    member = await db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == ctx.org_id,
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "active",
        )
    )
    if member is None:
        raise AppError("That person is not a member of this organization", code="invalid_user")


async def _get_contact(db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID) -> Contact:
    contact = await db.scalar(
        select(Contact).where(
            Contact.id == contact_id, Contact.organization_id == ctx.org_id, Contact.deleted_at.is_(None)
        )
    )
    if contact is None:
        raise NotFoundError("Contact not found")
    return contact


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw)
    if not 6 <= len(digits) <= 15:
        raise AppError("Enter the full number with country code", code="invalid_phone")
    return digits


# --- Contacts ----------------------------------------------------------------------------


async def _contact_out(db: AsyncSession, contacts: list[Contact]) -> list[ContactOut]:
    tags = await tags_for_contacts(db, (c.id for c in contacts))
    lead_counts: dict[uuid.UUID, int] = {}
    if contacts:
        rows = await db.execute(
            select(Lead.contact_id, func.count())
            .where(Lead.contact_id.in_([c.id for c in contacts]), Lead.stage.notin_(CLOSED_STAGES))
            .group_by(Lead.contact_id)
        )
        lead_counts = {cid: n for cid, n in rows}
    return [
        ContactOut(
            id=c.id, display_name=c.display_name, phone_number=c.phone_number, email=c.email, company=c.company,
            channel_type=c.channel_type, consent_status=c.consent_status, opted_out_at=c.opted_out_at,
            last_inbound_at=c.last_inbound_at, custom_fields=c.custom_fields or {}, tags=tags.get(c.id, []),
            open_leads=lead_counts.get(c.id, 0), created_at=c.created_at,
        )
        for c in contacts
    ]  # fmt: skip


async def list_contacts(
    db: AsyncSession, ctx: OrgContext, q: str | None, tag_id: uuid.UUID | None, page: int, page_size: int
) -> tuple[list[ContactOut], int]:
    ctx.require("contacts.read")
    where = [Contact.organization_id == ctx.org_id, Contact.deleted_at.is_(None)]
    if q:
        pattern = like_pattern(q.strip())
        where.append(
            or_(
                Contact.display_name.ilike(pattern),
                Contact.phone_number.ilike(pattern),
                Contact.email.ilike(pattern),
                Contact.company.ilike(pattern),
            )
        )
    if tag_id:
        where.append(Contact.id.in_(select(ContactTag.contact_id).where(ContactTag.tag_id == tag_id)))
    total = await db.scalar(select(func.count()).select_from(Contact).where(*where)) or 0
    contacts = list(
        (await db.scalars(
            select(Contact).where(*where)
            .order_by(Contact.last_inbound_at.desc().nulls_last(), Contact.created_at.desc())
            .offset((page - 1) * page_size).limit(page_size)
        )).all()
    )  # fmt: skip
    return await _contact_out(db, contacts), total


async def create_contact(db: AsyncSession, ctx: OrgContext, data: dict[str, Any]) -> ContactOut:
    ctx.require("contacts.manage")
    custom = await validate_custom_fields(db, ctx, "contact", data.pop("custom_fields", {}), None)
    phone = normalize_phone(data["phone_number"]) if data.get("phone_number") else None
    if phone:
        duplicate = await db.scalar(
            select(Contact.id).where(
                Contact.organization_id == ctx.org_id,
                Contact.phone_number == phone,
                Contact.deleted_at.is_(None),
            )
        )
        if duplicate:
            raise ConflictError("A contact with this phone number already exists", code="contact_exists",
                                details={"contact_id": str(duplicate)})  # fmt: skip
    now = datetime.now(UTC)
    contact = Contact(
        id=uuid.uuid4(),
        organization_id=ctx.org_id,
        # A phone number maps to the WhatsApp id, so a later message from it lands on this contact.
        channel_type="whatsapp_web" if phone else "manual",
        external_id=f"{phone}@c.us" if phone else f"manual:{uuid.uuid4().hex}",
        display_name=data["display_name"], phone_number=phone, email=data.get("email"), company=data.get("company"),
        custom_fields=custom, consent_status="unknown", created_by_user_id=ctx.user.id, created_at=now, updated_at=now,
    )  # fmt: skip
    db.add(contact)
    await db.flush()  # the timeline row references it
    await _record(db, ctx, contact.id, "contact.created", "Contact created")
    await db.commit()
    await publish(ctx.org_id, "contact.updated", contact_id=contact.id)
    await webhooks.emit(ctx.org_id, "contact.created", {
        "contact_id": str(contact.id), "name": contact.display_name, "phone": contact.phone_number,
        "email": contact.email, "source": "crm",
    })  # fmt: skip
    return (await _contact_out(db, [contact]))[0]


async def get_contact_detail(db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID) -> ContactDetail:
    ctx.require("contacts.read")
    contact = await _get_contact(db, ctx, contact_id)
    base = (await _contact_out(db, [contact]))[0]
    convs = await db.execute(
        select(Conversation, ChannelConnection.display_name)
        .join(ChannelConnection, ChannelConnection.id == Conversation.connection_id)
        .where(Conversation.contact_id == contact.id)
        .order_by(Conversation.last_message_at.desc().nulls_last())
    )
    leads, _ = await list_leads(db, ctx, contact_id=contact.id)
    tasks = await list_tasks(db, ctx, contact_id=contact.id, status="all")
    return ContactDetail(
        **base.model_dump(),
        conversations=[
            ContactConversationRef(
                id=c.id,
                connection_name=name,
                status=c.status,
                last_message_at=c.last_message_at,
                last_message_preview=c.last_message_preview,
            )
            for c, name in convs
        ],  # fmt: skip
        leads=leads,
        tasks=tasks,
    )


async def update_contact(
    db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, changes: dict[str, Any]
) -> ContactOut:
    ctx.require("contacts.manage")
    contact = await _get_contact(db, ctx, contact_id)
    if "custom_fields" in changes:
        contact.custom_fields = await validate_custom_fields(
            db, ctx, "contact", changes.pop("custom_fields") or {}, contact.custom_fields
        )
    if "phone_number" in changes:
        new_phone = normalize_phone(changes.pop("phone_number")) if changes.get("phone_number") else None
        if new_phone != contact.phone_number:
            if contact.channel_type != "manual":
                raise AppError("The number of a messaging contact cannot be changed", code="phone_locked")
            contact.phone_number = new_phone
    for key in ("display_name", "email", "company"):
        if key in changes:
            setattr(contact, key, changes[key])
    await db.commit()
    await publish(ctx.org_id, "contact.updated", contact_id=contact.id)
    return (await _contact_out(db, [contact]))[0]


async def set_consent(
    db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, opted_out: bool
) -> ContactOut:
    """Manual opt-out (e.g. the customer asked by phone). Recorded on the timeline."""
    ctx.require("contacts.manage")
    contact = await _get_contact(db, ctx, contact_id)
    contact.opted_out_at = datetime.now(UTC) if opted_out else None
    contact.consent_status = "opted_out" if opted_out else "engaged"
    await _record(db, ctx, contact.id, "consent.changed",
                  "Marked as opted out of messages" if opted_out else "Opt-out removed")  # fmt: skip
    await db.commit()
    await publish(ctx.org_id, "contact.updated", contact_id=contact.id)
    return (await _contact_out(db, [contact]))[0]


async def delete_contact(db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID) -> None:
    """Soft delete: hidden from lists; conversations keep their history."""
    ctx.require("contacts.manage")
    contact = await _get_contact(db, ctx, contact_id)
    contact.deleted_at = datetime.now(UTC)
    await db.commit()


async def list_activities(
    db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, limit: int = 100
) -> list[ActivityOut]:
    ctx.require("contacts.read")
    contact = await _get_contact(db, ctx, contact_id)
    rows = list(
        (await db.scalars(
            select(CustomerActivity).where(CustomerActivity.contact_id == contact.id)
            .order_by(CustomerActivity.created_at.desc()).limit(limit)
        )).all()
    )  # fmt: skip
    users = await users_by_id(db, (r.actor_user_id for r in rows))
    return [
        ActivityOut(
            id=r.id, activity_type=r.activity_type, summary=r.summary,
            actor=users.get(r.actor_user_id) if r.actor_user_id else None,
            lead_id=r.lead_id, details=r.details, created_at=r.created_at,
        )
        for r in rows
    ]  # fmt: skip


async def add_contact_note(db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, body: str) -> None:
    ctx.require("contacts.manage")
    contact = await _get_contact(db, ctx, contact_id)
    await _record(db, ctx, contact.id, "note", body)
    await db.commit()


# --- Leads -------------------------------------------------------------------------------


async def _lead_out(db: AsyncSession, leads: list[Lead]) -> list[LeadOut]:
    if not leads:
        return []
    contacts = {
        c.id: c
        for c in (
            await db.scalars(select(Contact).where(Contact.id.in_({lead.contact_id for lead in leads})))
        ).all()
    }
    users = await users_by_id(db, (lead.owner_user_id for lead in leads))
    task_counts = {
        lid: n
        for lid, n in await db.execute(
            select(FollowUpTask.lead_id, func.count())
            .where(FollowUpTask.lead_id.in_([lead.id for lead in leads]), FollowUpTask.completed_at.is_(None))
            .group_by(FollowUpTask.lead_id)
        )
    }
    out = []
    for lead in leads:
        c = contacts.get(lead.contact_id)
        out.append(
            LeadOut(
                id=lead.id, title=lead.title, stage=lead.stage, position=lead.position,  # type: ignore[arg-type]
                value_amount=lead.value_amount, currency=lead.currency, source=lead.source, score=lead.score,
                owner=users.get(lead.owner_user_id) if lead.owner_user_id else None,
                contact=LeadContact(
                    id=lead.contact_id, display_name=c.display_name if c else None,
                    phone_number=c.phone_number if c else None,
                ),
                expected_close_date=lead.expected_close_date, lost_reason=lead.lost_reason,
                closed_at=lead.closed_at, custom_fields=lead.custom_fields or {},
                open_tasks=task_counts.get(lead.id, 0), created_at=lead.created_at, updated_at=lead.updated_at,
            )
        )  # fmt: skip
    return out


async def list_leads(
    db: AsyncSession,
    ctx: OrgContext,
    *,
    stage: str | None = None,
    owner: str | None = None,
    q: str | None = None,
    contact_id: uuid.UUID | None = None,
) -> tuple[list[LeadOut], list[StageSummary]]:
    ctx.require("leads.read")
    where = [Lead.organization_id == ctx.org_id]
    if stage:
        where.append(Lead.stage == stage)
    if owner == "me":
        where.append(Lead.owner_user_id == ctx.user.id)
    elif owner == "unassigned":
        where.append(Lead.owner_user_id.is_(None))
    if contact_id:
        where.append(Lead.contact_id == contact_id)
    stmt = select(Lead).join(Contact, Contact.id == Lead.contact_id).where(*where)
    if q:
        pattern = like_pattern(q.strip())
        stmt = stmt.where(or_(Lead.title.ilike(pattern), Contact.display_name.ilike(pattern)))
    leads = list((await db.scalars(stmt.order_by(Lead.position, Lead.created_at.desc()).limit(500))).all())
    summary_rows = await db.execute(
        select(Lead.stage, func.count(), func.coalesce(func.sum(Lead.value_amount), 0))
        .where(Lead.organization_id == ctx.org_id)
        .group_by(Lead.stage)
    )
    by_stage = {s: (n, v) for s, n, v in summary_rows}
    summary = [
        StageSummary(
            stage=s, count=by_stage.get(s, (0, 0))[0], total_value=Decimal(by_stage.get(s, (0, 0))[1])
        )  # type: ignore[arg-type]
        for s in LEAD_STAGES
    ]
    return await _lead_out(db, leads), summary


async def _get_lead(db: AsyncSession, ctx: OrgContext, lead_id: uuid.UUID) -> Lead:
    lead = await db.scalar(select(Lead).where(Lead.id == lead_id, Lead.organization_id == ctx.org_id))
    if lead is None:
        raise NotFoundError("Lead not found")
    return lead


async def create_lead(db: AsyncSession, ctx: OrgContext, data: dict[str, Any]) -> LeadOut:
    ctx.require("leads.manage")
    contact = await _get_contact(db, ctx, data["contact_id"])
    await _ensure_member(db, ctx, data.get("owner_user_id"))
    custom = await validate_custom_fields(db, ctx, "lead", data.pop("custom_fields", {}), None)
    now = datetime.now(UTC)
    lead = Lead(
        id=uuid.uuid4(), organization_id=ctx.org_id, custom_fields=custom, created_by_user_id=ctx.user.id,
        closed_at=now if data.get("stage") in CLOSED_STAGES else None, created_at=now, updated_at=now, **data,
    )  # fmt: skip
    db.add(lead)
    await db.flush()  # the timeline row references it
    await _record(
        db, ctx, contact.id, "lead.created", f"Lead created: {lead.title}", lead.id, {"stage": lead.stage}
    )
    await db.commit()
    await publish(ctx.org_id, "lead.updated", lead_id=lead.id)
    return (await _lead_out(db, [lead]))[0]


async def update_lead(
    db: AsyncSession, ctx: OrgContext, lead_id: uuid.UUID, changes: dict[str, Any]
) -> LeadOut:
    ctx.require("leads.manage")
    lead = await _get_lead(db, ctx, lead_id)
    if "owner_user_id" in changes:
        await _ensure_member(db, ctx, changes["owner_user_id"])
    if "custom_fields" in changes:
        lead.custom_fields = await validate_custom_fields(
            db, ctx, "lead", changes.pop("custom_fields") or {}, lead.custom_fields
        )
    new_stage = changes.pop("stage", None)
    stage_change: dict[str, str] | None = None
    for key, value in changes.items():
        setattr(lead, key, value)
    if new_stage and new_stage != lead.stage:
        old = lead.stage
        lead.stage = new_stage
        lead.closed_at = datetime.now(UTC) if new_stage in CLOSED_STAGES else None
        if new_stage != "LOST":
            lead.lost_reason = None
        stage_change = {"from": old, "to": new_stage}
        await _record(db, ctx, lead.contact_id, "lead.stage_changed",
                      f"{lead.title}: {old.title()} → {new_stage.title()}", lead.id, {"from": old, "to": new_stage})  # fmt: skip
    await db.commit()
    await db.refresh(lead)
    await publish(ctx.org_id, "lead.updated", lead_id=lead.id)
    if stage_change:
        await webhooks.emit(ctx.org_id, "lead.stage_changed", {
            "lead_id": str(lead.id), "title": lead.title, "contact_id": str(lead.contact_id), **stage_change,
            "value_amount": str(lead.value_amount) if lead.value_amount is not None else None,
            "currency": lead.currency,
        })  # fmt: skip
    return (await _lead_out(db, [lead]))[0]


async def delete_lead(db: AsyncSession, ctx: OrgContext, lead_id: uuid.UUID) -> None:
    ctx.require("leads.manage")
    lead = await _get_lead(db, ctx, lead_id)
    await _record(db, ctx, lead.contact_id, "lead.deleted", f"Lead deleted: {lead.title}")
    await db.delete(lead)
    await db.commit()
    await publish(ctx.org_id, "lead.updated", lead_id=lead_id)


# --- Tasks -------------------------------------------------------------------------------


async def _task_out(db: AsyncSession, tasks: list[FollowUpTask]) -> list[TaskOut]:
    if not tasks:
        return []
    users = await users_by_id(db, [t.assignee_user_id for t in tasks] + [t.created_by_user_id for t in tasks])
    contact_ids = {t.contact_id for t in tasks if t.contact_id}
    lead_ids = {t.lead_id for t in tasks if t.lead_id}
    contacts = (
        {
            i: n
            for i, n in await db.execute(
                select(Contact.id, Contact.display_name).where(Contact.id.in_(contact_ids))
            )
        }
        if contact_ids
        else {}
    )
    leads = (
        {i: n for i, n in await db.execute(select(Lead.id, Lead.title).where(Lead.id.in_(lead_ids)))}
        if lead_ids
        else {}
    )
    return [
        TaskOut(
            id=t.id, title=t.title, description=t.description, due_at=t.due_at,
            assignee=users.get(t.assignee_user_id) if t.assignee_user_id else None,
            contact=TaskRef(id=t.contact_id, label=contacts.get(t.contact_id) or "Contact") if t.contact_id else None,
            lead=TaskRef(id=t.lead_id, label=leads.get(t.lead_id) or "Lead") if t.lead_id else None,
            conversation_id=t.conversation_id, completed_at=t.completed_at,
            created_by=users.get(t.created_by_user_id) if t.created_by_user_id else None, created_at=t.created_at,
        )
        for t in tasks
    ]  # fmt: skip


async def list_tasks(
    db: AsyncSession,
    ctx: OrgContext,
    *,
    scope: str = "all",
    status: str = "open",
    due: str | None = None,
    contact_id: uuid.UUID | None = None,
    lead_id: uuid.UUID | None = None,
    tz_offset_minutes: int = 0,
) -> list[TaskOut]:
    ctx.require("contacts.read")
    where = [FollowUpTask.organization_id == ctx.org_id]
    if scope == "mine":
        where.append(FollowUpTask.assignee_user_id == ctx.user.id)
    if status == "open":
        where.append(FollowUpTask.completed_at.is_(None))
    elif status == "done":
        where.append(FollowUpTask.completed_at.isnot(None))
    if contact_id:
        where.append(FollowUpTask.contact_id == contact_id)
    if lead_id:
        where.append(FollowUpTask.lead_id == lead_id)
    now = datetime.now(UTC)
    if due:
        # "Today" is the viewer's calendar day, given as their UTC offset.
        local_now = now + timedelta(minutes=tz_offset_minutes)
        start = datetime(local_now.year, local_now.month, local_now.day, tzinfo=UTC) - timedelta(
            minutes=tz_offset_minutes
        )
        end = start + timedelta(days=1)
        if due == "overdue":
            where.append(and_(FollowUpTask.due_at < now, FollowUpTask.completed_at.is_(None)))
        elif due == "today":
            where.append(and_(FollowUpTask.due_at >= start, FollowUpTask.due_at < end))
        elif due == "upcoming":
            where.append(FollowUpTask.due_at >= end)
    rows = await db.scalars(
        select(FollowUpTask).where(*where)
        .order_by(FollowUpTask.completed_at.isnot(None), FollowUpTask.due_at.asc().nulls_last(), FollowUpTask.created_at)
        .limit(500)
    )  # fmt: skip
    return await _task_out(db, list(rows.all()))


async def _get_task(db: AsyncSession, ctx: OrgContext, task_id: uuid.UUID) -> FollowUpTask:
    task = await db.scalar(
        select(FollowUpTask).where(FollowUpTask.id == task_id, FollowUpTask.organization_id == ctx.org_id)
    )
    if task is None:
        raise NotFoundError("Task not found")
    return task


async def create_task(db: AsyncSession, ctx: OrgContext, data: dict[str, Any]) -> TaskOut:
    ctx.require("contacts.manage")
    await _ensure_member(db, ctx, data.get("assignee_user_id"))
    contact_id = data.get("contact_id")
    if data.get("lead_id"):
        lead = await _get_lead(db, ctx, data["lead_id"])
        contact_id = contact_id or lead.contact_id
    if contact_id:
        await _get_contact(db, ctx, contact_id)
    if data.get("conversation_id"):
        conv = await db.scalar(
            select(Conversation).where(
                Conversation.id == data["conversation_id"], Conversation.organization_id == ctx.org_id
            )
        )
        if conv is None:
            raise NotFoundError("Conversation not found")
        contact_id = contact_id or conv.contact_id
    now = datetime.now(UTC)
    task = FollowUpTask(
        id=uuid.uuid4(), organization_id=ctx.org_id, created_by_user_id=ctx.user.id, created_at=now, updated_at=now,
        **{**data, "contact_id": contact_id},
    )  # fmt: skip
    db.add(task)
    await db.flush()
    if contact_id:
        await _record(db, ctx, contact_id, "task.created", f"Task: {task.title}", task.lead_id)
    await db.commit()
    await publish(ctx.org_id, "task.updated", task_id=task.id)
    return (await _task_out(db, [task]))[0]


async def update_task(
    db: AsyncSession, ctx: OrgContext, task_id: uuid.UUID, changes: dict[str, Any]
) -> TaskOut:
    ctx.require("contacts.manage")
    task = await _get_task(db, ctx, task_id)
    if "assignee_user_id" in changes:
        await _ensure_member(db, ctx, changes["assignee_user_id"])
    completed = changes.pop("completed", None)
    for key, value in changes.items():
        setattr(task, key, value)
    if completed is not None and completed != (task.completed_at is not None):
        task.completed_at = datetime.now(UTC) if completed else None
        if task.contact_id:
            await _record(db, ctx, task.contact_id, "task.completed" if completed else "task.reopened",
                          f"{'Completed' if completed else 'Reopened'}: {task.title}", task.lead_id)  # fmt: skip
    await db.commit()
    await db.refresh(task)
    await publish(ctx.org_id, "task.updated", task_id=task.id)
    return (await _task_out(db, [task]))[0]


async def delete_task(db: AsyncSession, ctx: OrgContext, task_id: uuid.UUID) -> None:
    ctx.require("contacts.manage")
    task = await _get_task(db, ctx, task_id)
    await db.delete(task)
    await db.commit()
    await publish(ctx.org_id, "task.updated", task_id=task_id)
