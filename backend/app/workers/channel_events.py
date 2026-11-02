"""Consumes normalized channel events from the gateway (Redis Stream) into the database.

    uv run python -m app.workers.channel_events

Delivery is at-least-once (Redis consumer group, ack after commit), so every handler is
idempotent: connection events are de-duplicated by event_id in channel_events, messages by
(connection_id, provider_message_id), and acknowledgements only ever move status forward.
"""

import asyncio
import json
import os
import socket
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import TypeAdapter, ValidationError
from redis.asyncio import Redis
from redis.exceptions import RedisError, ResponseError
from sqlalchemy import case, literal_column, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.database.session import SessionFactory, set_rls_context
from app.models import ChannelConnection, Contact, Conversation, Message, MessageAttachment
from app.models import ChannelEvent as ChannelEventRow
from app.models.messaging import STATUS_RANK
from app.schemas.channel_events import (
    ChannelEvent,
    ConnectionStateEvent,
    MessageAckEvent,
    MessageReceivedEvent,
    MessageSentEvent,
)
from app.services.messaging import preview
from app.services.realtime import publish
from app.workflow_engine.triggers import dispatch_inbound

log = get_logger("worker.channel_events")

GROUP = "backend"
_adapter: TypeAdapter[ChannelEvent] = TypeAdapter(ChannelEvent)

OPT_OUT_WORDS = {"STOP", "UNSUBSCRIBE", "STOP ALL", "OPT OUT", "OPTOUT"}
OPT_IN_WORDS = {"START", "SUBSCRIBE"}

STATE_SUMMARIES = {
    "INITIALIZING": "Starting session",
    "QR_PENDING": "Waiting for QR code scan",
    "AUTHENTICATING": "QR code scanned, authenticating",
    "CONNECTED": "Connected",
    "DISCONNECTED": "Disconnected",
    "RECONNECTING": "Reconnecting",
    "ERROR": "Error",
    "LOGGED_OUT": "Logged out",
    "NOT_CONNECTED": "Not connected",
}


def parse_event(raw: str) -> ChannelEvent:
    return _adapter.validate_python(json.loads(raw))


async def _connection(db: AsyncSession, event: ChannelEvent) -> ChannelConnection | None:
    # RLS scopes this to the event's organization; a mismatched org/connection pair finds nothing.
    return await db.scalar(
        select(ChannelConnection).where(
            ChannelConnection.id == event.connection_id,
            ChannelConnection.organization_id == event.organization_id,
        )
    )


async def _handle_state(db: AsyncSession, conn: ChannelConnection, event: ConnectionStateEvent) -> None:
    inserted = await db.scalar(
        insert(ChannelEventRow)
        .values(
            organization_id=event.organization_id,
            connection_id=conn.id,
            event_id=event.event_id,
            event_type=event.event_type,
            summary=STATE_SUMMARIES.get(event.payload.status, event.payload.status),
            details=event.payload.model_dump(exclude_none=True),
            occurred_at=event.occurred_at,
            created_at=datetime.now(UTC),
        )
        .on_conflict_do_nothing(index_elements=[ChannelEventRow.event_id])
        .returning(ChannelEventRow.id)
    )
    if inserted is None:
        return  # duplicate delivery
    # A removed connection keeps its log but no longer changes state.
    if conn.deleted_at is not None:
        return
    p = event.payload
    conn.status = p.status
    conn.status_detail = p.detail
    if p.status == "CONNECTED":
        conn.last_connected_at = event.occurred_at
        conn.phone_number = p.phone_number or conn.phone_number
        conn.account_name = p.account_name or conn.account_name
    elif p.status in {"DISCONNECTED", "LOGGED_OUT", "ERROR"}:
        conn.last_disconnected_at = event.occurred_at
    if p.status == "LOGGED_OUT":
        conn.session_reference = None


@dataclass
class Inbound:
    """What a stored inbound message means for automations (dispatched after commit)."""

    conversation_id: uuid.UUID
    message_id: uuid.UUID
    text: str | None
    new_conversation: bool
    new_contact: bool


async def _handle_received(
    db: AsyncSession, conn: ChannelConnection, event: MessageReceivedEvent
) -> Inbound | None:
    p = event.payload
    now = datetime.now(UTC)
    contact_row = (
        await db.execute(
            insert(Contact)
            .values(
                organization_id=event.organization_id,
                channel_type=conn.channel_type,
                external_id=p.sender,
                display_name=p.sender_name,
                phone_number=p.sender_phone,
                last_inbound_at=event.occurred_at,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(
                constraint="uq_contacts_org_channel_external",
                set_={
                    "display_name": p.sender_name or Contact.display_name,
                    "last_inbound_at": event.occurred_at,
                    "deleted_at": None,
                    "consent_status": case(
                        (Contact.consent_status == "unknown", "engaged"), else_=Contact.consent_status
                    ),
                    "updated_at": now,
                },
            )
            .returning(Contact.id, literal_column("xmax = 0"))
        )
    ).one()
    contact_id, contact_created = contact_row
    contact = await db.get(Contact, contact_id)
    assert contact is not None

    keyword = (p.content or "").strip().upper()
    if keyword in OPT_OUT_WORDS and contact.opted_out_at is None:
        contact.opted_out_at = event.occurred_at
        contact.consent_status = "opted_out"
    elif keyword in OPT_IN_WORDS and contact.opted_out_at is not None:
        contact.opted_out_at = None
        contact.consent_status = "engaged"

    conv_row = (
        await db.execute(
            insert(Conversation)
            .values(
                organization_id=event.organization_id,
                connection_id=conn.id,
                contact_id=contact.id,
                external_chat_id=p.chat_id,
                is_group=p.is_group,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_update(constraint="uq_conversations_connection_chat", set_={"updated_at": now})
            .returning(Conversation.id, literal_column("xmax = 0"))
        )
    ).one()
    conv_id, conv_created = conv_row
    msg_id = await db.scalar(
        insert(Message)
        .values(
            organization_id=event.organization_id,
            connection_id=conn.id,
            conversation_id=conv_id,
            direction="inbound",
            provider_message_id=p.provider_message_id,
            message_type=p.message_type,
            content=p.content,
            status="received",
            sender_external_id=p.sender,
            provider_timestamp=p.provider_timestamp,
            created_at=event.occurred_at,
        )
        .on_conflict_do_nothing(
            index_elements=[Message.connection_id, Message.provider_message_id],
            index_where=Message.provider_message_id.isnot(None),
        )
        .returning(Message.id)
    )
    if msg_id is None:
        return None  # duplicate message: counters untouched, automations not triggered again
    if p.attachment is not None:
        # Uploaded by the gateway just before this event; bind it only within this organization.
        await db.execute(
            update(MessageAttachment)
            .where(
                MessageAttachment.id == p.attachment.attachment_id,
                MessageAttachment.organization_id == event.organization_id,
                MessageAttachment.message_id.is_(None),
            )
            .values(message_id=msg_id)
        )
    await db.execute(
        update(Conversation)
        .where(Conversation.id == conv_id)
        .values(
            last_message_at=event.occurred_at,
            last_message_preview=preview(p.content) or f"[{p.message_type}]",
            unread_count=Conversation.unread_count + 1,
            # A new customer message reopens the conversation; an owner keeps it.
            status=case(
                (Conversation.status.in_(("OPEN", "PENDING", "ASSIGNED")), Conversation.status),
                (Conversation.assigned_user_id.isnot(None), "ASSIGNED"),
                else_="OPEN",
            ),
            resolved_at=None,
        )
    )
    return Inbound(
        conv_id, msg_id, p.content, new_conversation=bool(conv_created), new_contact=bool(contact_created)
    )


async def _handle_sent(db: AsyncSession, conn: ChannelConnection, event: MessageSentEvent) -> None:
    await db.execute(
        update(Message)
        .where(
            Message.organization_id == event.organization_id,
            Message.client_message_id == event.payload.client_message_id,
            Message.provider_message_id.is_(None),
        )
        .values(provider_message_id=event.payload.provider_message_id)
    )


async def _handle_ack(db: AsyncSession, conn: ChannelConnection, event: MessageAckEvent) -> None:
    msg = await db.scalar(
        select(Message).where(
            Message.connection_id == conn.id, Message.provider_message_id == event.payload.provider_message_id
        )
    )
    if msg is None or msg.direction != "outbound":
        return
    new = event.payload.status
    if new == "failed":
        if msg.status in {"queued", "sent"}:
            msg.status, msg.error = "failed", "Rejected by WhatsApp"
    elif STATUS_RANK.get(new, -1) > STATUS_RANK.get(msg.status, -1):
        msg.status = new
    msg.status_updated_at = event.occurred_at


HANDLERS: dict[type, Any] = {
    ConnectionStateEvent: _handle_state,
    MessageReceivedEvent: _handle_received,
    MessageSentEvent: _handle_sent,
    MessageAckEvent: _handle_ack,
}


async def process_event(
    event: ChannelEvent, session_factory: async_sessionmaker[AsyncSession] = SessionFactory
) -> bool:
    """Applies one event in its own transaction. Returns False if the event was ignored."""
    async with session_factory() as db:
        await set_rls_context(db, user_id=None, org_id=event.organization_id)
        conn = await _connection(db, event)
        if conn is None:
            log.warning("event_for_unknown_connection", event_id=str(event.event_id), type=event.event_type)
            return False
        outcome = await HANDLERS[type(event)](db, conn, event)
        await db.commit()
    await _notify(event)
    if isinstance(outcome, Inbound):
        try:
            await dispatch_inbound(
                event.organization_id, outcome.conversation_id, outcome.message_id, outcome.text,
                new_conversation=outcome.new_conversation, new_contact=outcome.new_contact,
            )  # fmt: skip
        except Exception:
            # The message is stored; a failing automation must never block message processing.
            log.exception("workflow_dispatch_failed", event_id=str(event.event_id))
    return True


async def _notify(event: ChannelEvent) -> None:
    """Tell connected browsers what changed (ids only; they refetch through the API)."""
    if isinstance(event, ConnectionStateEvent):
        await publish(event.organization_id, "connection.updated", connection_id=event.connection_id)
    elif isinstance(event, MessageReceivedEvent):
        await publish(event.organization_id, "message.created", connection_id=event.connection_id)
    elif isinstance(event, MessageAckEvent):
        await publish(event.organization_id, "message.updated", connection_id=event.connection_id)


async def run(stop: asyncio.Event | None = None) -> None:
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    stream = settings.channel_event_stream
    consumer = f"{socket.gethostname()}-{os.getpid()}"
    try:
        await redis.xgroup_create(stream, GROUP, id="0", mkstream=True)
    except ResponseError as exc:
        if "BUSYGROUP" not in str(exc):
            raise
    log.info("worker_started", stream=stream, consumer=consumer)

    # First drain this consumer's pending (delivered but unacknowledged) entries, then new ones.
    cursor = "0"
    while stop is None or not stop.is_set():
        try:
            batches = await redis.xreadgroup(GROUP, consumer, {stream: cursor}, count=50, block=5000)
        except RedisError as exc:
            log.error("stream_read_failed", error=str(exc))
            await asyncio.sleep(2)
            continue
        entries = batches[0][1] if batches else []
        if cursor == "0" and not entries:
            cursor = ">"
            continue
        for entry_id, fields in entries:
            try:
                event = parse_event(fields["event"])
            except (ValidationError, KeyError, json.JSONDecodeError) as exc:
                # Poison message: it can never succeed, so record and drop it.
                log.error("invalid_event_dropped", entry_id=entry_id, error=str(exc)[:500])
                await redis.xack(stream, GROUP, entry_id)
                continue
            try:
                await process_event(event)
            except Exception:
                # Transient failure (e.g. database down): leave unacknowledged and retry later.
                log.exception("event_processing_failed", entry_id=entry_id, event_id=str(event.event_id))
                await asyncio.sleep(1)
                cursor = "0"
                break
            await redis.xack(stream, GROUP, entry_id)
    await redis.aclose()


if __name__ == "__main__":
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.environment == "production")
    asyncio.run(run())
