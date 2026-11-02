"""Channel connections and their lifecycle log.

The backend never talks to WhatsApp directly: the messaging gateway owns sessions and reports
normalized events (see docs/WHATSAPP_CONNECTOR.md). These tables hold the tenant-visible state.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey

CHANNEL_TYPES = ("whatsapp_web", "simulator")

CONNECTION_STATUSES = (
    "NOT_CONNECTED",
    "INITIALIZING",
    "QR_PENDING",
    "AUTHENTICATING",
    "CONNECTED",
    "DISCONNECTED",
    "RECONNECTING",
    "ERROR",
    "LOGGED_OUT",
)


class ChannelConnection(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "channel_connections"
    __table_args__ = (
        Index("ix_channel_connections_org", "organization_id", postgresql_where=text("deleted_at IS NULL")),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    channel_type: Mapped[str] = mapped_column(String(30))
    display_name: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str | None] = mapped_column(String(32))
    account_name: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="NOT_CONNECTED", server_default="NOT_CONNECTED")
    status_detail: Mapped[str | None] = mapped_column(String(500))
    # Opaque handle to the gateway-side session store; never a filesystem path exposed to clients.
    session_reference: Mapped[str | None] = mapped_column(String(100))
    last_connected_at: Mapped[datetime | None]
    last_disconnected_at: Mapped[datetime | None]
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None]


class ChannelEvent(UUIDPrimaryKey, CreatedAt, Base):
    """Connection log + idempotency ledger: a gateway event_id is processed at most once."""

    __tablename__ = "channel_events"
    __table_args__ = (Index("ix_channel_events_connection_created", "connection_id", "created_at"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    connection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("channel_connections.id", ondelete="CASCADE"))
    event_id: Mapped[uuid.UUID] = mapped_column(unique=True)
    event_type: Mapped[str] = mapped_column(String(50))
    summary: Mapped[str | None] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    occurred_at: Mapped[datetime]
