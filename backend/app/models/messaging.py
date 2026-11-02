import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey

# Delivery states we can actually observe. "received" is used for inbound messages.
MESSAGE_STATUSES = ("queued", "sent", "delivered", "read", "played", "failed", "received")
# Forward-only ordering for acknowledgement updates (a late "sent" must not undo "read").
STATUS_RANK = {"queued": 0, "sent": 1, "delivered": 2, "read": 3, "played": 4}

CONVERSATION_STATUSES = ("OPEN", "PENDING", "ASSIGNED", "RESOLVED", "ARCHIVED")
PRIORITIES = ("low", "normal", "high", "urgent")


class Contact(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint(
            "organization_id", "channel_type", "external_id", name="uq_contacts_org_channel_external"
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    # "whatsapp_web"/"simulator" for channel contacts; "manual" for contacts without a phone.
    channel_type: Mapped[str] = mapped_column(String(30))
    external_id: Mapped[str] = mapped_column(String(100))  # e.g. "919876543210@c.us"
    display_name: Mapped[str | None] = mapped_column(String(200))
    phone_number: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    company: Mapped[str | None] = mapped_column(String(200))
    # Values for organization-defined custom fields (validated against custom_field_definitions).
    custom_fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    # Consent: a contact who messages first has engaged; STOP/UNSUBSCRIBE records an opt-out.
    consent_status: Mapped[str] = mapped_column(String(20), default="engaged", server_default="engaged")
    opted_out_at: Mapped[datetime | None]
    last_inbound_at: Mapped[datetime | None]
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None]


class Conversation(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("connection_id", "external_chat_id", name="uq_conversations_connection_chat"),
        Index("ix_conversations_org_last_message", "organization_id", text("last_message_at DESC")),
        Index("ix_conversations_org_assignee", "organization_id", "assigned_user_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channel_connections.id", ondelete="CASCADE"))
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    external_chat_id: Mapped[str] = mapped_column(String(100))
    is_group: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(20), default="OPEN", server_default="OPEN")
    priority: Mapped[str] = mapped_column(String(10), default="normal", server_default="normal")
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    # Human takeover: automations (M4) must not reply while a person is handling the conversation.
    automation_paused: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    resolved_at: Mapped[datetime | None]
    last_message_at: Mapped[datetime | None]
    last_message_preview: Mapped[str | None] = mapped_column(String(200))
    unread_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Message(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "messages"
    __table_args__ = (
        # Deduplication: the same provider message is stored once per connection.
        Index(
            "uq_messages_connection_provider_id",
            "connection_id",
            "provider_message_id",
            unique=True,
            postgresql_where=text("provider_message_id IS NOT NULL"),
        ),
        # Duplicate-send protection for outbound messages (client-supplied idempotency key).
        UniqueConstraint("organization_id", "client_message_id", name="uq_messages_org_client_id"),
        Index("ix_messages_conversation_created", "conversation_id", "created_at"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channel_connections.id", ondelete="CASCADE"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("conversations.id", ondelete="CASCADE"))
    direction: Mapped[str] = mapped_column(String(10))  # "inbound" | "outbound"
    provider_message_id: Mapped[str | None] = mapped_column(String(200))
    client_message_id: Mapped[str | None] = mapped_column(String(64))
    message_type: Mapped[str] = mapped_column(String(30), default="text")
    content: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20))
    error: Mapped[str | None] = mapped_column(String(500))
    sender_external_id: Mapped[str | None] = mapped_column(String(100))
    sent_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    provider_timestamp: Mapped[datetime | None]
    status_updated_at: Mapped[datetime | None]


class MessageAttachment(UUIDPrimaryKey, CreatedAt, Base):
    """File stored in object storage (MinIO/S3). Keys are prefixed with the organization id."""

    __tablename__ = "message_attachments"

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True
    )
    storage_key: Mapped[str] = mapped_column(String(500), unique=True)
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)


class ConversationNote(UUIDPrimaryKey, CreatedAt, Base):
    """Internal note: visible to the team only, never sent to the customer."""

    __tablename__ = "conversation_notes"

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    author_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)


class ConversationAssignment(UUIDPrimaryKey, CreatedAt, Base):
    """History of who handled a conversation (current assignee lives on the conversation)."""

    __tablename__ = "conversation_assignments"

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assigned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class Tag(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "tags"
    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_tags_org_name"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(50))
    color: Mapped[str] = mapped_column(String(20), default="neutral", server_default="neutral")


class ContactTag(Base):
    __tablename__ = "contact_tags"

    contact_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
