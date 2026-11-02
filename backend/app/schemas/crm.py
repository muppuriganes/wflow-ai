import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal

from pydantic import AwareDatetime, BaseModel, EmailStr, Field, StringConstraints

from app.schemas.common import APIModel
from app.schemas.inbox import TagOut, UserRef

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[\d\s\-()]{6,20}$")]
Stage = Literal["NEW", "QUALIFIED", "CONTACTED", "PROPOSAL", "NEGOTIATION", "CONVERTED", "LOST"]
FieldType = Literal["text", "number", "date", "select", "boolean"]
Entity = Literal["contact", "lead"]


# --- Custom fields ---------------------------------------------------------------------


class CustomFieldCreate(BaseModel):
    entity: Entity
    key: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,49}$")]
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    field_type: FieldType
    options: list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] = (
        Field(default_factory=list, max_length=50)
    )
    required: bool = False


class CustomFieldUpdate(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)] | None = (
        None
    )
    options: (
        list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]] | None
    ) = None
    required: bool | None = None
    archived: bool | None = None


class CustomFieldOut(APIModel):
    id: uuid.UUID
    entity: str
    key: str
    label: str
    field_type: str
    options: list[str]
    required: bool
    archived: bool


# --- Contacts --------------------------------------------------------------------------


class ContactCreate(BaseModel):
    display_name: Name
    phone_number: Phone | None = None
    email: EmailStr | None = None
    company: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class ContactUpdate(BaseModel):
    display_name: Name | None = None
    phone_number: Phone | None = None
    email: EmailStr | None = None
    company: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    custom_fields: dict[str, Any] | None = None


class ConsentUpdate(BaseModel):
    opted_out: bool


class ContactOut(BaseModel):
    id: uuid.UUID
    display_name: str | None
    phone_number: str | None
    email: str | None
    company: str | None
    channel_type: str
    consent_status: str
    opted_out_at: datetime | None
    last_inbound_at: datetime | None
    custom_fields: dict[str, Any]
    tags: list[TagOut]
    open_leads: int = 0
    created_at: datetime


class ContactConversationRef(BaseModel):
    id: uuid.UUID
    connection_name: str
    status: str
    last_message_at: datetime | None
    last_message_preview: str | None


class ActivityOut(BaseModel):
    id: uuid.UUID
    activity_type: str
    summary: str
    actor: UserRef | None
    lead_id: uuid.UUID | None
    details: dict[str, Any]
    created_at: datetime


class ActivityCreate(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


# --- Leads -----------------------------------------------------------------------------


class LeadCreate(BaseModel):
    contact_id: uuid.UUID
    title: Name
    stage: Stage = "NEW"
    value_amount: Annotated[Decimal, Field(ge=0, le=Decimal("999999999999"), decimal_places=2)] | None = None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] = "INR"
    source: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None
    score: Annotated[int, Field(ge=0, le=100)] = 0
    owner_user_id: uuid.UUID | None = None
    expected_close_date: date | None = None
    custom_fields: dict[str, Any] = Field(default_factory=dict)


class LeadUpdate(BaseModel):
    title: Name | None = None
    stage: Stage | None = None
    position: Annotated[int, Field(ge=0, le=1_000_000)] | None = None
    value_amount: Annotated[Decimal, Field(ge=0, le=Decimal("999999999999"), decimal_places=2)] | None = None
    currency: Annotated[str, StringConstraints(pattern=r"^[A-Z]{3}$")] | None = None
    source: Annotated[str, StringConstraints(strip_whitespace=True, max_length=50)] | None = None
    score: Annotated[int, Field(ge=0, le=100)] | None = None
    owner_user_id: uuid.UUID | None = None
    expected_close_date: date | None = None
    lost_reason: Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None = None
    custom_fields: dict[str, Any] | None = None


class LeadContact(BaseModel):
    id: uuid.UUID
    display_name: str | None
    phone_number: str | None


class LeadOut(BaseModel):
    id: uuid.UUID
    title: str
    stage: Stage
    position: int
    value_amount: Decimal | None
    currency: str
    source: str | None
    score: int
    owner: UserRef | None
    contact: LeadContact
    expected_close_date: date | None
    lost_reason: str | None
    closed_at: datetime | None
    custom_fields: dict[str, Any]
    open_tasks: int = 0
    created_at: datetime
    updated_at: datetime


class StageSummary(BaseModel):
    stage: Stage
    count: int
    total_value: Decimal


# --- Tasks -----------------------------------------------------------------------------


class TaskCreate(BaseModel):
    title: Name
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    # Must carry a timezone offset: tasks are shown in each viewer's local time.
    due_at: AwareDatetime | None = None
    assignee_user_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    lead_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None


class TaskUpdate(BaseModel):
    title: Name | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] | None = None
    due_at: AwareDatetime | None = None
    assignee_user_id: uuid.UUID | None = None
    completed: bool | None = None


class TaskRef(BaseModel):
    id: uuid.UUID
    label: str


class TaskOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    due_at: datetime | None
    assignee: UserRef | None
    contact: TaskRef | None
    lead: TaskRef | None
    conversation_id: uuid.UUID | None
    completed_at: datetime | None
    created_by: UserRef | None
    created_at: datetime


class ContactDetail(ContactOut):
    conversations: list[ContactConversationRef]
    leads: list[LeadOut]
    tasks: list[TaskOut]
