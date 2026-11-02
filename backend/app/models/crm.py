import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey

# Fixed pipeline (ADR-007): stages are part of reporting and automation contracts, so they are
# an enumeration rather than per-tenant data. Custom pipelines can be added later.
LEAD_STAGES = ("NEW", "QUALIFIED", "CONTACTED", "PROPOSAL", "NEGOTIATION", "CONVERTED", "LOST")
CLOSED_STAGES = frozenset({"CONVERTED", "LOST"})
CUSTOM_FIELD_TYPES = ("text", "number", "date", "select", "boolean")


class Lead(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "leads"
    __table_args__ = (Index("ix_leads_org_stage", "organization_id", "stage"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    stage: Mapped[str] = mapped_column(String(20), default="NEW", server_default="NEW")
    value_amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    currency: Mapped[str] = mapped_column(String(3), default="INR", server_default="INR")
    source: Mapped[str | None] = mapped_column(String(50))  # whatsapp, website, referral, manual…
    score: Mapped[int] = mapped_column(Integer, default=0, server_default="0")  # 0–100
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expected_close_date: Mapped[date | None]
    lost_reason: Mapped[str | None] = mapped_column(String(300))
    closed_at: Mapped[datetime | None]
    # Order within a pipeline column (drag and drop).
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    custom_fields: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class FollowUpTask(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "follow_up_tasks"
    __table_args__ = (
        Index("ix_tasks_org_assignee_open", "organization_id", "assignee_user_id",
              postgresql_where=text("completed_at IS NULL")),
    )  # fmt: skip

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    due_at: Mapped[datetime | None]  # timezone-aware
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("contacts.id", ondelete="CASCADE"), index=True
    )
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL")
    )
    completed_at: Mapped[datetime | None]
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class CustomerActivity(UUIDPrimaryKey, CreatedAt, Base):
    """Timeline of a contact: notes, stage changes, tasks, conversation events. Append-only."""

    __tablename__ = "customer_activities"
    __table_args__ = (Index("ix_activities_contact_created", "contact_id", "created_at"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    contact_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"))
    lead_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("leads.id", ondelete="SET NULL"))
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    activity_type: Mapped[str] = mapped_column(String(40))  # note, lead.created, lead.stage_changed, task.*…
    summary: Mapped[str] = mapped_column(Text)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")


class CustomFieldDefinition(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "custom_field_definitions"
    __table_args__ = (
        UniqueConstraint("organization_id", "entity", "key", name="uq_custom_fields_org_entity_key"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    entity: Mapped[str] = mapped_column(String(20))  # "contact" | "lead"
    key: Mapped[str] = mapped_column(String(50))
    label: Mapped[str] = mapped_column(String(100))
    field_type: Mapped[str] = mapped_column(String(20))
    options: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
