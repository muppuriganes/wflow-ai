import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey


class Plan(UUIDPrimaryKey, Timestamps, Base):
    """Global plan definition. Shared across all organizations (read-only for tenants)."""

    __tablename__ = "plans"

    key: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(255), default="", server_default="")
    price_cents_monthly: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    price_cents_yearly: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    currency: Mapped[str] = mapped_column(String(10), default="usd", server_default="usd")
    limits: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    features: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))


class Subscription(UUIDPrimaryKey, Timestamps, Base):
    """Organization subscription linking to a Plan. One active subscription per organization."""

    __tablename__ = "subscriptions"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, index=True
    )
    plan_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plans.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(
        String(32), default="trialing", server_default="trialing"
    )  # trialing, active, past_due, canceled
    billing_interval: Mapped[str] = mapped_column(
        String(16), default="monthly", server_default="monthly"
    )  # monthly, yearly
    current_period_start: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    current_period_end: Mapped[datetime] = mapped_column(default=datetime.utcnow)
    trial_end: Mapped[datetime | None] = mapped_column(default=None)
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    provider: Mapped[str] = mapped_column(String(32), default="stripe", server_default="stripe")
    provider_customer_id: Mapped[str | None] = mapped_column(String(255), default=None)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(255), default=None)

    plan: Mapped[Plan] = relationship("Plan", lazy="joined")


class UsageCounter(UUIDPrimaryKey, Timestamps, Base):
    """Atomic monthly usage counters per organization for billing and rate limits."""

    __tablename__ = "usage_counters"
    __table_args__ = (
        UniqueConstraint("organization_id", "year_month", name="uq_usage_counters_org_month"),
        Index("ix_usage_counters_org_month", "organization_id", "year_month"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    year_month: Mapped[str] = mapped_column(String(7))  # "YYYY-MM"
    workflow_runs_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    outbound_messages_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class InvoiceRecord(UUIDPrimaryKey, CreatedAt, Base):
    """Invoice records for billing history."""

    __tablename__ = "invoices"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    subscription_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"), default=None
    )
    invoice_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(10), default="usd", server_default="usd")
    status: Mapped[str] = mapped_column(String(32), default="paid", server_default="paid")  # paid, open, void
    period_start: Mapped[datetime]
    period_end: Mapped[datetime]
    pdf_url: Mapped[str | None] = mapped_column(String(500), default=None)
    provider_invoice_id: Mapped[str | None] = mapped_column(String(255), default=None)


class ProcessedProviderEvent(UUIDPrimaryKey, CreatedAt, Base):
    """Deduplication table for incoming payment provider webhooks (Stripe / Razorpay)."""

    __tablename__ = "processed_provider_events"
    __table_args__ = (
        UniqueConstraint("provider", "event_id", name="uq_processed_provider_events_provider_event"),
    )

    provider: Mapped[str] = mapped_column(String(32))
    event_id: Mapped[str] = mapped_column(String(255))


class WebhookEndpoint(UUIDPrimaryKey, Timestamps, Base):
    """Outgoing webhook subscription for an organization."""

    __tablename__ = "webhooks"

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    target_url: Mapped[str] = mapped_column(String(1000))
    secret_key: Mapped[str] = mapped_column(String(128))  # HMAC signing secret
    events: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    disabled_reason: Mapped[str | None] = mapped_column(String(255), default=None)


class WebhookDelivery(UUIDPrimaryKey, CreatedAt, Base):
    """Delivery log and retry tracking for outgoing webhooks."""

    __tablename__ = "webhook_deliveries"
    __table_args__ = (Index("ix_webhook_deliveries_webhook_created", "webhook_id", "created_at"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    webhook_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("webhooks.id", ondelete="CASCADE"), index=True)
    event_type: Mapped[str] = mapped_column(String(100), index=True)
    event_id: Mapped[str] = mapped_column(String(64), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    response_status: Mapped[int | None] = mapped_column(Integer, default=None)
    response_body: Mapped[str | None] = mapped_column(String(2000), default=None)
    duration_ms: Mapped[int | None] = mapped_column(Integer, default=None)
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    success: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    error: Mapped[str | None] = mapped_column(String(1000), default=None)


class IntegrationCredential(UUIDPrimaryKey, Timestamps, Base):
    """Encrypted credential stored for third-party HTTP integrations."""

    __tablename__ = "integration_credentials"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", name="uq_integration_credentials_org_name"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(100))
    type: Mapped[str] = mapped_column(String(32), default="bearer")  # api_key, bearer, basic
    encrypted_secret: Mapped[str] = mapped_column(String(1000))
    masked_secret: Mapped[str] = mapped_column(String(64))  # e.g. "••••1234"
