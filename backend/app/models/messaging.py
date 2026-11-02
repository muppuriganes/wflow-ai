import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey

# Delivery states we can actually observe. "received" is used for inbound messages.
MESSAGE_STATUSES = ("queued", "sent", "delivered", "read", "played", "failed", "received")
# Forward-only ordering for acknowledgement updates (a late "sent" must not undo "read").
STATUS_RANK = {"queued": 0, "sent": 1, "delivered": 2, "read": 3, "played": 4}


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
    channel_type: Mapped[str] = mapped_column(String(30))
    external_id: Mapped[str] = mapped_column(String(100))  # e.g. "919876543210@c.us"
    display_name: Mapped[str | None] = mapped_column(String(200))
    phone_number: Mapped[str | None] = mapped_column(String(32))
    # Consent: a contact who messages first has engaged; STOP/UNSUBSCRIBE records an opt-out.
    consent_status: Mapped[str] = mapped_column(String(20), default="engaged", server_default="engaged")
    opted_out_at: Mapped[datetime | None]
    last_inbound_at: Mapped[datetime | None]


class Conversation(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "conversations"
    __table_args__ = (
        UniqueConstraint("connection_id", "external_chat_id", name="uq_conversations_connection_chat"),
        Index("ix_conversations_org_last_message", "organization_id", text("last_message_at DESC")),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channel_connections.id", ondelete="CASCADE"))
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    external_chat_id: Mapped[str] = mapped_column(String(100))
    is_group: Mapped[bool] = mapped_column(default=False, server_default=text("false"))
    status: Mapped[str] = mapped_column(String(20), default="OPEN", server_default="OPEN")
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
