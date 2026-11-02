"""Team inbox: conversation queue, assignment, status, priority, human takeover, notes and tags."""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import Select, and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ConflictError, NotFoundError, PermissionDeniedError
from app.models import (
    ChannelConnection,
    Contact,
    ContactTag,
    Conversation,
    ConversationAssignment,
    ConversationNote,
    OrganizationMember,
    Permission,
    Role,
    RolePermission,
    Tag,
    User,
)
from app.schemas.inbox import (
    AssigneeOption,
    InboxContact,
    InboxConversation,
    InboxCounts,
    TagOut,
    UserRef,
)
from app.services.organizations import OrgContext
from app.services.realtime import publish

ACTIVE_STATUSES = ("OPEN", "PENDING", "ASSIGNED")


@dataclass
class ConversationFilters:
    view: str = "active"  # active | mine | unassigned | resolved | archived | all
    connection_id: uuid.UUID | None = None
    tag_id: uuid.UUID | None = None
    priority: str | None = None
    q: str | None = None


def like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


async def users_by_id(db: AsyncSession, ids: Iterable[uuid.UUID | None]) -> dict[uuid.UUID, UserRef]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    rows = await db.execute(select(User.id, User.full_name).where(User.id.in_(wanted)))
    return {uid: UserRef(id=uid, full_name=name) for uid, name in rows}


async def tags_for_contacts(
    db: AsyncSession, contact_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, list[TagOut]]:
    ids = list(set(contact_ids))
    result: dict[uuid.UUID, list[TagOut]] = {cid: [] for cid in ids}
    if not ids:
        return result
    rows = await db.execute(
        select(ContactTag.contact_id, Tag).join(Tag, Tag.id == ContactTag.tag_id).where(ContactTag.contact_id.in_(ids))
        .order_by(Tag.name)
    )  # fmt: skip
    for contact_id, tag in rows:
        result[contact_id].append(TagOut.model_validate(tag))
    return result


def _apply_filters(stmt: Select, ctx: OrgContext, f: ConversationFilters) -> Select:  # type: ignore[type-arg]
    stmt = stmt.where(Conversation.organization_id == ctx.org_id)
    if f.view == "active":
        stmt = stmt.where(Conversation.status.in_(ACTIVE_STATUSES))
    elif f.view == "mine":
        stmt = stmt.where(
            Conversation.assigned_user_id == ctx.user.id, Conversation.status.in_(ACTIVE_STATUSES)
        )
    elif f.view == "unassigned":
        stmt = stmt.where(Conversation.assigned_user_id.is_(None), Conversation.status.in_(ACTIVE_STATUSES))
    elif f.view == "resolved":
        stmt = stmt.where(Conversation.status == "RESOLVED")
    elif f.view == "archived":
        stmt = stmt.where(Conversation.status == "ARCHIVED")
    if f.connection_id:
        stmt = stmt.where(Conversation.connection_id == f.connection_id)
    if f.priority:
        stmt = stmt.where(Conversation.priority == f.priority)
    if f.tag_id:
        stmt = stmt.where(
            Conversation.contact_id.in_(select(ContactTag.contact_id).where(ContactTag.tag_id == f.tag_id))
        )
    if f.q:
        pattern = like_pattern(f.q.strip())
        stmt = stmt.where(
            or_(
                Contact.display_name.ilike(pattern),
                Contact.phone_number.ilike(pattern),
                Conversation.last_message_preview.ilike(pattern),
            )
        )
    return stmt


async def _serialize(
    db: AsyncSession, rows: list[tuple[Conversation, Contact, ChannelConnection]]
) -> list[InboxConversation]:
    users = await users_by_id(db, (c.assigned_user_id for c, _, _ in rows))
    tags = await tags_for_contacts(db, (contact.id for _, contact, _ in rows))
    return [
        InboxConversation(
            id=c.id,
            connection_id=c.connection_id,
            connection_name=conn.display_name,
            connection_status=conn.status,
            contact=InboxContact(
                id=contact.id,
                display_name=contact.display_name,
                phone_number=contact.phone_number,
                email=contact.email,
                consent_status=contact.consent_status,
                opted_out_at=contact.opted_out_at,
                tags=tags.get(contact.id, []),
            ),
            is_group=c.is_group,
            status=c.status,  # type: ignore[arg-type]
            priority=c.priority,  # type: ignore[arg-type]
            assignee=users.get(c.assigned_user_id) if c.assigned_user_id else None,
            automation_paused=c.automation_paused,
            last_message_at=c.last_message_at,
            last_message_preview=c.last_message_preview,
            unread_count=c.unread_count,
            resolved_at=c.resolved_at,
            created_at=c.created_at,
        )
        for c, contact, conn in rows
    ]


def _base_query() -> Select:  # type: ignore[type-arg]
    return (
        select(Conversation, Contact, ChannelConnection)
        .join(Contact, Contact.id == Conversation.contact_id)
        .join(ChannelConnection, ChannelConnection.id == Conversation.connection_id)
    )


async def list_conversations(
    db: AsyncSession, ctx: OrgContext, f: ConversationFilters, page: int, page_size: int
) -> tuple[list[InboxConversation], int]:
    ctx.require("inbox.read")
    count_stmt = _apply_filters(
        select(func.count()).select_from(Conversation).join(Contact, Contact.id == Conversation.contact_id),
        ctx,
        f,
    )
    total = await db.scalar(count_stmt) or 0
    stmt = (
        _apply_filters(_base_query(), ctx, f)
        .order_by(Conversation.last_message_at.desc().nulls_last(), Conversation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = [(c, contact, conn) for c, contact, conn in (await db.execute(stmt)).all()]
    return await _serialize(db, rows), total


async def counts(db: AsyncSession, ctx: OrgContext) -> InboxCounts:
    ctx.require("inbox.read")
    base = (Conversation.organization_id == ctx.org_id,)
    active = Conversation.status.in_(ACTIVE_STATUSES)
    row = (
        await db.execute(
            select(
                func.count().filter(and_(active, Conversation.assigned_user_id == ctx.user.id)),
                func.count().filter(and_(active, Conversation.assigned_user_id.is_(None))),
                func.count().filter(active),
                func.count().filter(Conversation.status == "RESOLVED"),
            ).where(*base)
        )
    ).one()
    return InboxCounts(mine=row[0], unassigned=row[1], open=row[2], resolved=row[3])


async def get_conversation_row(db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID) -> Conversation:
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.organization_id == ctx.org_id
        )
    )
    if conv is None:
        raise NotFoundError("Conversation not found")
    return conv


async def get_conversation(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID
) -> InboxConversation:
    ctx.require("inbox.read")
    row = (
        await db.execute(
            _base_query().where(
                Conversation.id == conversation_id, Conversation.organization_id == ctx.org_id
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Conversation not found")
    return (await _serialize(db, [(row[0], row[1], row[2])]))[0]


async def assignee_options(db: AsyncSession, ctx: OrgContext) -> list[AssigneeOption]:
    """Active members whose role can read the inbox."""
    ctx.require("inbox.read")
    rows = await db.execute(
        select(User.id, User.full_name, User.email, Role.name)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .join(Role, Role.id == OrganizationMember.role_id)
        .join(RolePermission, RolePermission.role_id == Role.id)
        .join(Permission, Permission.id == RolePermission.permission_id)
        .where(
            OrganizationMember.organization_id == ctx.org_id,
            OrganizationMember.status == "active",
            User.is_active.is_(True),
            Permission.code == "inbox.read",
        )
        .order_by(User.full_name)
    )
    return [AssigneeOption(id=i, full_name=n, email=e, role_name=r) for i, n, e, r in rows]


async def assign(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, user_id: uuid.UUID | None
) -> InboxConversation:
    """Anyone who can reply may take an unassigned conversation; reassigning needs inbox.assign."""
    conv = await get_conversation_row(db, ctx, conversation_id)
    self_claim = user_id == ctx.user.id and conv.assigned_user_id in (None, ctx.user.id)
    if self_claim:
        ctx.require("inbox.reply")
    else:
        ctx.require("inbox.assign")
    if user_id is not None and user_id not in {o.id for o in await assignee_options(db, ctx)}:
        raise AppError(
            "That person cannot handle conversations in this organization", code="invalid_assignee"
        )
    if conv.assigned_user_id == user_id:
        return await get_conversation(db, ctx, conversation_id)
    conv.assigned_user_id = user_id
    if conv.status in ACTIVE_STATUSES:
        conv.status = "ASSIGNED" if user_id else "OPEN"
    db.add(
        ConversationAssignment(
            organization_id=ctx.org_id,
            conversation_id=conv.id,
            assigned_user_id=user_id,
            assigned_by_user_id=ctx.user.id,
        )
    )
    await db.commit()
    await publish(ctx.org_id, "conversation.updated", conversation_id=conv.id)
    return await get_conversation(db, ctx, conversation_id)


async def set_status(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, status: str
) -> InboxConversation:
    ctx.require("inbox.reply")
    conv = await get_conversation_row(db, ctx, conversation_id)
    if status == "ASSIGNED" and conv.assigned_user_id is None:
        raise ConflictError("Assign the conversation to someone first", code="no_assignee")
    if status == "OPEN" and conv.assigned_user_id is not None:
        status = "ASSIGNED"  # reopening keeps the current owner
    conv.status = status
    conv.resolved_at = datetime.now(UTC) if status == "RESOLVED" else None
    if status in {"RESOLVED", "ARCHIVED"}:
        conv.unread_count = 0
    await db.commit()
    await publish(ctx.org_id, "conversation.updated", conversation_id=conv.id)
    return await get_conversation(db, ctx, conversation_id)


async def set_priority(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, priority: str
) -> InboxConversation:
    ctx.require("inbox.reply")
    conv = await get_conversation_row(db, ctx, conversation_id)
    conv.priority = priority
    await db.commit()
    await publish(ctx.org_id, "conversation.updated", conversation_id=conv.id)
    return await get_conversation(db, ctx, conversation_id)


async def set_takeover(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, paused: bool
) -> InboxConversation:
    """Human takeover: while paused, automations must not send messages in this conversation."""
    ctx.require("inbox.reply")
    conv = await get_conversation_row(db, ctx, conversation_id)
    conv.automation_paused = paused
    if paused and conv.assigned_user_id is None:
        conv.assigned_user_id = ctx.user.id
        conv.status = "ASSIGNED" if conv.status in ACTIVE_STATUSES else conv.status
        db.add(
            ConversationAssignment(
                organization_id=ctx.org_id, conversation_id=conv.id,
                assigned_user_id=ctx.user.id, assigned_by_user_id=ctx.user.id,
            )
        )  # fmt: skip
    await db.commit()
    await publish(ctx.org_id, "conversation.updated", conversation_id=conv.id)
    return await get_conversation(db, ctx, conversation_id)


# --- Notes and assignment history ------------------------------------------------------


async def list_notes(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID
) -> list[tuple[ConversationNote, UserRef | None]]:
    ctx.require("inbox.read")
    conv = await get_conversation_row(db, ctx, conversation_id)
    notes = list(
        (await db.scalars(
            select(ConversationNote).where(ConversationNote.conversation_id == conv.id).order_by(ConversationNote.created_at)
        )).all()
    )  # fmt: skip
    users = await users_by_id(db, (n.author_user_id for n in notes))
    return [(n, users.get(n.author_user_id) if n.author_user_id else None) for n in notes]


async def add_note(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, body: str
) -> ConversationNote:
    ctx.require("inbox.reply")
    conv = await get_conversation_row(db, ctx, conversation_id)
    note = ConversationNote(
        organization_id=ctx.org_id, conversation_id=conv.id, author_user_id=ctx.user.id, body=body,
        created_at=datetime.now(UTC),
    )  # fmt: skip
    db.add(note)
    await db.commit()
    await publish(ctx.org_id, "conversation.note_added", conversation_id=conv.id)
    return note


async def assignment_history(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID
) -> list[tuple[ConversationAssignment, UserRef | None, UserRef | None]]:
    ctx.require("inbox.read")
    conv = await get_conversation_row(db, ctx, conversation_id)
    rows = list(
        (await db.scalars(
            select(ConversationAssignment).where(ConversationAssignment.conversation_id == conv.id)
            .order_by(ConversationAssignment.created_at.desc())
        )).all()
    )  # fmt: skip
    users = await users_by_id(db, [r.assigned_user_id for r in rows] + [r.assigned_by_user_id for r in rows])
    return [
        (r, users.get(r.assigned_user_id) if r.assigned_user_id else None,
         users.get(r.assigned_by_user_id) if r.assigned_by_user_id else None)
        for r in rows
    ]  # fmt: skip


# --- Tags ------------------------------------------------------------------------------


async def list_tags(db: AsyncSession, ctx: OrgContext) -> list[Tag]:
    ctx.require("contacts.read")
    return list(
        (await db.scalars(select(Tag).where(Tag.organization_id == ctx.org_id).order_by(Tag.name))).all()
    )


async def create_tag(db: AsyncSession, ctx: OrgContext, name: str, color: str) -> Tag:
    ctx.require("contacts.manage")
    if await db.scalar(
        select(Tag.id).where(Tag.organization_id == ctx.org_id, func.lower(Tag.name) == name.lower())
    ):
        raise ConflictError("A tag with this name already exists", code="tag_exists")
    tag = Tag(organization_id=ctx.org_id, name=name, color=color, created_at=datetime.now(UTC))
    db.add(tag)
    await db.commit()
    return tag


async def update_tag(
    db: AsyncSession, ctx: OrgContext, tag_id: uuid.UUID, name: str | None, color: str | None
) -> Tag:
    ctx.require("contacts.manage")
    tag = await db.scalar(select(Tag).where(Tag.id == tag_id, Tag.organization_id == ctx.org_id))
    if tag is None:
        raise NotFoundError("Tag not found")
    if name:
        tag.name = name
    if color:
        tag.color = color
    await db.commit()
    return tag


async def delete_tag(db: AsyncSession, ctx: OrgContext, tag_id: uuid.UUID) -> None:
    ctx.require("contacts.manage")
    tag = await db.scalar(select(Tag).where(Tag.id == tag_id, Tag.organization_id == ctx.org_id))
    if tag is None:
        raise NotFoundError("Tag not found")
    await db.delete(tag)
    await db.commit()


async def set_contact_tags(
    db: AsyncSession, ctx: OrgContext, contact_id: uuid.UUID, tag_ids: list[uuid.UUID]
) -> list[TagOut]:
    ctx.require("contacts.manage")
    contact = await db.scalar(
        select(Contact).where(
            Contact.id == contact_id, Contact.organization_id == ctx.org_id, Contact.deleted_at.is_(None)
        )
    )
    if contact is None:
        raise NotFoundError("Contact not found")
    valid = set(
        (await db.scalars(select(Tag.id).where(Tag.organization_id == ctx.org_id, Tag.id.in_(tag_ids)))).all()
    )
    if valid != set(tag_ids):
        raise PermissionDeniedError("Unknown tag", code="unknown_tag")
    current = set(
        (await db.scalars(select(ContactTag.tag_id).where(ContactTag.contact_id == contact.id))).all()
    )
    for tag_id in current - valid:
        await db.delete(await db.get(ContactTag, (contact.id, tag_id)))
    for tag_id in valid - current:
        db.add(ContactTag(contact_id=contact.id, tag_id=tag_id, organization_id=ctx.org_id))
    await db.commit()
    await publish(ctx.org_id, "contact.updated", contact_id=contact.id)
    return (await tags_for_contacts(db, [contact.id]))[contact.id]
