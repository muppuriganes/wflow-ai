"""Conversations and messages: read models for the inbox plus the guarded outbound send path."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.rate_limit import enforce_rate_limit
from app.models import ChannelConnection, Contact, Conversation, Message
from app.services.gateway import get_gateway
from app.services.organizations import OrgContext


def preview(text: str | None) -> str | None:
    return (text or "").strip().replace("\n", " ")[:200] or None


async def list_conversations(
    db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID | None, page: int, page_size: int
) -> tuple[list[tuple[Conversation, Contact]], int]:
    ctx.require("inbox.read")
    where = [Conversation.organization_id == ctx.org_id]
    if connection_id:
        where.append(Conversation.connection_id == connection_id)
    total = await db.scalar(select(func.count()).select_from(Conversation).where(*where)) or 0
    rows = await db.execute(
        select(Conversation, Contact)
        .join(Contact, Contact.id == Conversation.contact_id)
        .where(*where)
        .order_by(Conversation.last_message_at.desc().nulls_last())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return [(c, contact) for c, contact in rows.all()], total


async def _get_conversation(db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID) -> Conversation:
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.organization_id == ctx.org_id
        )
    )
    if conv is None:
        raise NotFoundError("Conversation not found")
    return conv


async def list_messages(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, limit: int = 100
) -> list[Message]:
    ctx.require("inbox.read")
    conv = await _get_conversation(db, ctx, conversation_id)
    rows = await db.scalars(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(limit)
    )
    if conv.unread_count:
        conv.unread_count = 0
        await db.commit()
    return list(reversed(rows.all()))


async def send_text(
    db: AsyncSession, ctx: OrgContext, conversation_id: uuid.UUID, text: str, client_message_id: str
) -> Message:
    """Messaging governance enforced here, not in the UI:
    - idempotent on client_message_id (double-clicks and retries never double-send);
    - replies only to contacts who wrote first (no unsolicited outreach);
    - opted-out contacts are never messaged;
    - per-connection send rate limit."""
    ctx.require("inbox.reply")
    existing = await db.scalar(
        select(Message).where(
            Message.organization_id == ctx.org_id, Message.client_message_id == client_message_id
        )
    )
    if existing is not None:
        return existing

    conv = await _get_conversation(db, ctx, conversation_id)
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
    await enforce_rate_limit(
        "send", str(conn.id), limit=get_settings().channel_send_limit_per_minute, window_seconds=60
    )

    msg = Message(
        organization_id=ctx.org_id,
        connection_id=conn.id,
        conversation_id=conv.id,
        direction="outbound",
        client_message_id=client_message_id,
        message_type="text",
        content=text,
        status="queued",
        sent_by_user_id=ctx.user.id,
        created_at=datetime.now(UTC),
    )
    db.add(msg)
    try:
        await db.commit()
    except IntegrityError:
        # A concurrent request with the same idempotency key won the race.
        await db.rollback()
        winner = await db.scalar(
            select(Message).where(
                Message.organization_id == ctx.org_id, Message.client_message_id == client_message_id
            )
        )
        if winner is None:
            raise
        return winner

    now = datetime.now(UTC)
    try:
        result = await get_gateway().send_text(
            conn.id, ctx.org_id, conv.external_chat_id, text, client_message_id
        )
    except AppError as exc:
        msg.status = "failed"
        msg.error = exc.message[:500]
    else:
        # A fast ack event may already have stored the provider id; only fill it if missing.
        msg.provider_message_id = msg.provider_message_id or result.provider_message_id
        if msg.status == "queued":
            msg.status = "sent"
    msg.status_updated_at = now
    conv.last_message_at = now
    conv.last_message_preview = preview(text)
    await db.commit()
    await db.refresh(msg)
    return msg
