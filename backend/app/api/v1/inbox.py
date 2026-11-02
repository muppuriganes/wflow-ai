import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, Query, UploadFile, status

from app.api.deps import DB, OrgCtx
from app.core.errors import AppError
from app.schemas.channels import SendMessage
from app.schemas.common import Page
from app.schemas.inbox import (
    AssigneeOption,
    AssignmentOut,
    AssignRequest,
    InboxConversation,
    InboxCounts,
    MessageOut,
    NoteCreate,
    NoteOut,
    PriorityRequest,
    StatusRequest,
    TagCreate,
    TagOut,
    TagUpdate,
    TakeoverRequest,
)
from app.services import inbox as inbox_service
from app.services import messaging as messaging_service
from app.services.files import MAX_ATTACHMENT_BYTES

router = APIRouter(prefix="/organizations/{org_id}", tags=["inbox"])

View = Literal["active", "mine", "unassigned", "resolved", "archived", "all"]


@router.get("/conversations")
async def list_conversations(
    db: DB,
    ctx: OrgCtx,
    view: View = "active",
    connection_id: uuid.UUID | None = None,
    tag_id: uuid.UUID | None = None,
    priority: Literal["low", "normal", "high", "urgent"] | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 30,
) -> Page[InboxConversation]:
    filters = inbox_service.ConversationFilters(
        view=view, connection_id=connection_id, tag_id=tag_id, priority=priority, q=q or None
    )
    items, total = await inbox_service.list_conversations(db, ctx, filters, page, page_size)
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/inbox/counts")
async def inbox_counts(db: DB, ctx: OrgCtx) -> InboxCounts:
    return await inbox_service.counts(db, ctx)


@router.get("/inbox/assignees")
async def assignees(db: DB, ctx: OrgCtx) -> list[AssigneeOption]:
    return await inbox_service.assignee_options(db, ctx)


@router.get("/conversations/{conversation_id}")
async def get_conversation(conversation_id: uuid.UUID, db: DB, ctx: OrgCtx) -> InboxConversation:
    return await inbox_service.get_conversation(db, ctx, conversation_id)


@router.post("/conversations/{conversation_id}/assign")
async def assign(conversation_id: uuid.UUID, data: AssignRequest, db: DB, ctx: OrgCtx) -> InboxConversation:
    return await inbox_service.assign(db, ctx, conversation_id, data.user_id)


@router.post("/conversations/{conversation_id}/status")
async def set_status(
    conversation_id: uuid.UUID, data: StatusRequest, db: DB, ctx: OrgCtx
) -> InboxConversation:
    return await inbox_service.set_status(db, ctx, conversation_id, data.status)


@router.post("/conversations/{conversation_id}/priority")
async def set_priority(
    conversation_id: uuid.UUID, data: PriorityRequest, db: DB, ctx: OrgCtx
) -> InboxConversation:
    return await inbox_service.set_priority(db, ctx, conversation_id, data.priority)


@router.post("/conversations/{conversation_id}/takeover")
async def takeover(
    conversation_id: uuid.UUID, data: TakeoverRequest, db: DB, ctx: OrgCtx
) -> InboxConversation:
    return await inbox_service.set_takeover(db, ctx, conversation_id, data.automation_paused)


@router.get("/conversations/{conversation_id}/notes")
async def list_notes(conversation_id: uuid.UUID, db: DB, ctx: OrgCtx) -> list[NoteOut]:
    return [
        NoteOut(id=n.id, body=n.body, author=author, created_at=n.created_at)
        for n, author in await inbox_service.list_notes(db, ctx, conversation_id)
    ]


@router.post("/conversations/{conversation_id}/notes", status_code=status.HTTP_201_CREATED)
async def add_note(conversation_id: uuid.UUID, data: NoteCreate, db: DB, ctx: OrgCtx) -> NoteOut:
    note = await inbox_service.add_note(db, ctx, conversation_id, data.body)
    author = (await inbox_service.users_by_id(db, [ctx.user.id])).get(ctx.user.id)
    return NoteOut(id=note.id, body=note.body, author=author, created_at=note.created_at)


@router.get("/conversations/{conversation_id}/assignments")
async def assignment_history(conversation_id: uuid.UUID, db: DB, ctx: OrgCtx) -> list[AssignmentOut]:
    return [
        AssignmentOut(assignee=to, assigned_by=by, created_at=a.created_at)
        for a, to, by in await inbox_service.assignment_history(db, ctx, conversation_id)
    ]


@router.get("/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: uuid.UUID, db: DB, ctx: OrgCtx) -> list[MessageOut]:
    return await messaging_service.list_messages(db, ctx, conversation_id)


@router.post("/conversations/{conversation_id}/messages", status_code=status.HTTP_201_CREATED)
async def send_message(conversation_id: uuid.UUID, data: SendMessage, db: DB, ctx: OrgCtx) -> MessageOut:
    return await messaging_service.send(db, ctx, conversation_id, data.client_message_id, data.text)


@router.post("/conversations/{conversation_id}/attachments", status_code=status.HTTP_201_CREATED)
async def send_attachment(
    conversation_id: uuid.UUID,
    db: DB,
    ctx: OrgCtx,
    file: Annotated[UploadFile, File()],
    client_message_id: Annotated[str, Form(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_\-]+$")],
    caption: Annotated[str | None, Form(max_length=1024)] = None,
) -> MessageOut:
    ctx.require("inbox.reply")
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AppError("Files can be at most 16 MB", code="file_too_large")
    return await messaging_service.send(
        db, ctx, conversation_id, client_message_id, (caption or "").strip() or None,
        messaging_service.OutgoingFile(data=data, file_name=file.filename or "file"),
    )  # fmt: skip


@router.get("/attachments/{attachment_id}/url")
async def attachment_url(attachment_id: uuid.UUID, db: DB, ctx: OrgCtx) -> dict[str, str | int]:
    """Short-lived signed link (5 minutes) so files load directly from storage."""
    url, att = await messaging_service.attachment_url(db, ctx, attachment_id)
    return {
        "url": url,
        "file_name": att.file_name,
        "content_type": att.content_type,
        "size_bytes": att.size_bytes,
    }


# --- Tags -------------------------------------------------------------------------------


@router.get("/tags")
async def list_tags(db: DB, ctx: OrgCtx) -> list[TagOut]:
    return [TagOut.model_validate(t) for t in await inbox_service.list_tags(db, ctx)]


@router.post("/tags", status_code=status.HTTP_201_CREATED)
async def create_tag(data: TagCreate, db: DB, ctx: OrgCtx) -> TagOut:
    return TagOut.model_validate(await inbox_service.create_tag(db, ctx, data.name, data.color))


@router.patch("/tags/{tag_id}")
async def update_tag(tag_id: uuid.UUID, data: TagUpdate, db: DB, ctx: OrgCtx) -> TagOut:
    return TagOut.model_validate(await inbox_service.update_tag(db, ctx, tag_id, data.name, data.color))


@router.delete("/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(tag_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await inbox_service.delete_tag(db, ctx, tag_id)


@router.put("/contacts/{contact_id}/tags")
async def set_contact_tags(
    contact_id: uuid.UUID, tag_ids: list[uuid.UUID], db: DB, ctx: OrgCtx
) -> list[TagOut]:
    return await inbox_service.set_contact_tags(db, ctx, contact_id, tag_ids)
