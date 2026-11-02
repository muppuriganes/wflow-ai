"""Messages: the conversation timeline plus the single guarded outbound send path."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.rate_limit import enforce_rate_limit
from app.models import ChannelConnection, Contact, Conversation, Message, MessageAttachment
from app.schemas.inbox import AttachmentOut, MessageOut
from app.services.files import validate_upload
from app.services.gateway import get_gateway
from app.services.inbox import get_conversation_row, users_by_id
from app.services.organizations import OrgContext
from app.services.realtime import publish
from app.services.storage import attachment_key, get_storage


def preview(text: str | None) -> str | None:
    return (text or "").strip().replace("\n", " ")[:200] or None


@dataclass
class OutgoingFile:
    data: bytes
    file_name: str


async def serialize_messages(db: AsyncSession, messages: list[Message]) -> list[MessageOut]:
    ids = [m.id for m in messages]
    attachments: dict[uuid.UUID, list[AttachmentOut]] = {i: [] for i in ids}
    if ids:
        rows = await db.scalars(select(MessageAttachment).where(MessageAttachment.message_id.in_(ids)))
        for a in rows:
            if a.message_id:
                attachments[a.message_id].append(AttachmentOut.model_validate(a))
    users = await users_by_id(db, (m.sent_by_user_id for m in messages))
    return [
        MessageOut(
            id=m.id,
            conversation_id=m.conversation_id,
            direction=m.direction,
            message_type=m.message_type,
            content=m.content,
            status=m.status,
            error=m.error,
            sent_by=users.get(m.sent_by_user_id) if m.sent_by_user_id else None,
            attachments=attachments.get(m.id, []),
            created_at=m.created_at,
            status_updated_at=m.status_updated_at,
        )
        for m in messages
    ]


async def list_messages(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, limit: int = 200
) -> list[MessageOut]:
    ctx.require("inbox.read")
    conv = await get_conversation_row(db, ctx, conversation_id)
    rows = await db.scalars(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    messages = list(reversed(rows.all()))
    if conv.unread_count:
        conv.unread_count = 0
        await db.commit()
        await publish(ctx.org_id, "conversation.updated", conversation_id=conv.id)
    return await serialize_messages(db, messages)


async def send(
    db: AsyncSession,
    ctx: OrgContext,
    conversation_id: uuid.UUID,
    client_message_id: str,
    text: str | None,
    file: OutgoingFile | None = None,
) -> MessageOut:
    """Messaging governance enforced here, not in the UI:
    - idempotent on client_message_id (double-clicks and retries never double-send);
    - replies only to contacts who wrote first (no unsolicited outreach);
    - opted-out contacts are never messaged;
    - per-connection send rate limit."""
    ctx.require("inbox.reply")
    if not text and file is None:
        raise AppError("Write a message or attach a file", code="empty_message")
    existing = await db.scalar(
        select(Message).where(
            Message.organization_id == ctx.org_id, Message.client_message_id == client_message_id
        )
    )
    if existing is not None:
        return (await serialize_messages(db, [existing]))[0]

    conv = await get_conversation_row(db, ctx, conversation_id)
    contact = await db.get(Contact, conv.contact_id)
    conn = await db.get(ChannelConnection, conv.connection_id)
    if contact is None or conn is None or conn.deleted_at is not None:
        raise NotFoundError("Conversation not found")
    if contact.opted_out_at is not None:
        raise ConflictError("This contact opted out of messages", code="contact_opted_out")
    if contact.last_inbound_at is None:
        raise ConflictError(
            "You can only reply to contacts who have messaged this number", code="not_customer_initiated"
        )
    if conn.status != "CONNECTED":
        raise ConflictError("This channel is not connected", code="connection_not_ready")

    detected = None
    if file is not None:
        detected, safe_name = validate_upload(file.data, file.file_name)
    await enforce_rate_limit(
        "send", str(conn.id), limit=get_settings().channel_send_limit_per_minute, window_seconds=60
    )

    storage_key = None
    if file is not None and detected is not None:
        storage_key = attachment_key(ctx.org_id, safe_name)
        await get_storage().put(storage_key, file.data, detected.content_type)

    now = datetime.now(UTC)
    msg = Message(
        id=uuid.uuid4(),
        organization_id=ctx.org_id,
        connection_id=conn.id,
        conversation_id=conv.id,
        direction="outbound",
        client_message_id=client_message_id,
        message_type=detected.message_type if detected else "text",
        content=text,
        status="queued",
        sent_by_user_id=ctx.user.id,
        created_at=now,
    )
    db.add(msg)
    if storage_key and detected:
        db.add(
            MessageAttachment(
                organization_id=ctx.org_id, message_id=msg.id, storage_key=storage_key, file_name=safe_name,
                content_type=detected.content_type, size_bytes=len(file.data) if file else 0, created_at=now,
            )
        )  # fmt: skip
    try:
        await db.commit()
    except IntegrityError:
        # A concurrent request with the same idempotency key won the race.
        await db.rollback()
        if storage_key:
            await get_storage().delete(storage_key)
        winner = await db.scalar(
            select(Message).where(
                Message.organization_id == ctx.org_id, Message.client_message_id == client_message_id
            )
        )
        if winner is None:
            raise
        return (await serialize_messages(db, [winner]))[0]

    gateway = get_gateway()
    try:
        if storage_key and detected:
            result = await gateway.send_media(
                conn.id, ctx.org_id, conv.external_chat_id,
                media_url=get_storage().url(storage_key, file_name=safe_name, internal=True, expires=600),
                file_name=safe_name, content_type=detected.content_type, caption=text,
                client_message_id=client_message_id,
            )  # fmt: skip
        else:
            result = await gateway.send_text(
                conn.id, ctx.org_id, conv.external_chat_id, text or "", client_message_id
            )
    except AppError as exc:
        msg.status = "failed"
        msg.error = exc.message[:500]
    else:
        # A fast ack event may already have stored the provider id; only fill it if missing.
        msg.provider_message_id = msg.provider_message_id or result.provider_message_id
        if msg.status == "queued":
            msg.status = "sent"
    msg.status_updated_at = datetime.now(UTC)
    conv.last_message_at = now
    conv.last_message_preview = preview(text) or (f"[{detected.message_type}]" if detected else None)
    if conv.status == "RESOLVED":
        conv.status = "ASSIGNED" if conv.assigned_user_id else "OPEN"
        conv.resolved_at = None
    await db.commit()
    await publish(ctx.org_id, "message.created", conversation_id=conv.id)
    return (await serialize_messages(db, [msg]))[0]


async def attachment_url(
    db: AsyncSession, ctx: OrgContext, attachment_id: uuid.UUID
) -> tuple[str, MessageAttachment]:
    ctx.require("inbox.read")
    att = await db.scalar(
        select(MessageAttachment).where(
            MessageAttachment.id == attachment_id, MessageAttachment.organization_id == ctx.org_id
        )
    )
    if att is None:
        raise NotFoundError("Attachment not found")
    return get_storage().url(att.storage_key, file_name=att.file_name), att


async def ensure_conversation(db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID) -> Conversation:
    return await get_conversation_row(db, ctx, conversation_id)
