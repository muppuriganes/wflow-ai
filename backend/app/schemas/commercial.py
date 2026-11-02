import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class PlanOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    key: str
    name: str
    description: str
    price_cents_monthly: int
    price_cents_yearly: int
    currency: str
    limits: dict[str, int]
    features: dict[str, Any]
    is_active: bool


class SubscriptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    plan_id: uuid.UUID
    plan_key: str
    plan_name: str
    status: str
    billing_interval: str
    current_period_start: datetime
    current_period_end: datetime
    trial_end: datetime | None
    cancel_at_period_end: bool
    provider: str


class UsageMeterItem(BaseModel):
    metric: str
    label: str
    used: int
    limit: int
    percentage: float


class PlanUsageOverview(BaseModel):
    plan: PlanOut
    subscription: SubscriptionOut
    trial_days_remaining: int | None
    meters: list[UsageMeterItem]


class ChangePlanIn(BaseModel):
    plan_key: str
    billing_interval: Literal["monthly", "yearly"] = "monthly"


class CheckoutIn(BaseModel):
    plan_key: str
    return_url: str = Field(min_length=1, max_length=1000)


class PortalIn(BaseModel):
    return_url: str = Field(min_length=1, max_length=1000)


class InvoiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    invoice_number: str
    amount_cents: int
    currency: str
    status: str
    period_start: datetime
    period_end: datetime
    pdf_url: str | None
    created_at: datetime


class WebhookCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    target_url: str = Field(min_length=8, max_length=1000)
    events: list[str] = Field(min_length=1)
    is_active: bool = True


class WebhookUpdateIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    target_url: str | None = Field(default=None, min_length=8, max_length=1000)
    events: list[str] | None = None
    is_active: bool | None = None


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    target_url: str
    events: list[str]
    is_active: bool
    consecutive_failures: int
    disabled_reason: str | None
    created_at: datetime
    updated_at: datetime


class WebhookCreateOut(WebhookOut):
    secret_key: str  # Revealed only once at creation time


class WebhookDeliveryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    webhook_id: uuid.UUID
    event_type: str
    event_id: str
    payload: dict[str, Any]
    response_status: int | None
    response_body: str | None
    duration_ms: int | None
    attempt: int
    success: bool
    error: str | None
    created_at: datetime


class CredentialCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    type: Literal["api_key", "bearer", "basic"] = "bearer"
    secret: str = Field(min_length=1, max_length=2000)


class CredentialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    name: str
    type: str
    masked_secret: str
    created_at: datetime
    updated_at: datetime


# --- Super Admin Console Schemas ----------------------------------------------


class AdminOrgListItem(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str
    created_at: datetime
    plan_key: str
    plan_name: str
    subscription_status: str
    trial_ends_at: datetime | None
    members_count: int
    workflows_count: int
    channels_count: int


class AdminOrgListOut(BaseModel):
    items: list[AdminOrgListItem]
    total: int
    page: int
    page_size: int


class AdminOrgDetailOut(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    status: str
    suspended_at: datetime | None
    suspended_reason: str | None
    created_at: datetime
    subscription: SubscriptionOut | None = None
    plan: PlanOut | None = None
    current_usage: dict[str, int]
    members_count: int
    workflows_count: int
    channels_count: int
    recent_audit_events: list[dict[str, Any]]


class AdminAssignPlanIn(BaseModel):
    plan_key: str = Field(min_length=1, max_length=50)
    trial_days: int | None = Field(default=None, ge=1, le=365)


class AdminSuspendOrgIn(BaseModel):
    reason: str = Field(min_length=1, max_length=255)


class AdminHealthOut(BaseModel):
    status: str  # healthy, degraded
    services: dict[str, Any]
