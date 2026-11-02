import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, StringConstraints

from app.schemas.common import APIModel

ConversationStatus = Literal["OPEN", "PENDING", "ASSIGNED", "RESOLVED", "ARCHIVED"]
Priority = Literal["low", "normal", "high", "urgent"]
TagColor = Literal["neutral", "primary", "success", "warning", "danger", "info"]


class TagOut(APIModel):
    id: uuid.UUID
    name: str
    color: str


class TagCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    color: TagColor = "neutral"


class TagUpdate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)] | None = None
    color: TagColor | None = None


class UserRef(BaseModel):
    id: uuid.UUID
    full_name: str


class InboxContact(BaseModel):
    id: uuid.UUID
    display_name: str | None
    phone_number: str | None
    email: str | None
    consent_status: str
    opted_out_at: datetime | None
    tags: list[TagOut]


class InboxConversation(BaseModel):
    id: uuid.UUID
    connection_id: uuid.UUID
    connection_name: str
    connection_status: str
    contact: InboxContact
    is_group: bool
    status: ConversationStatus
    priority: Priority
    assignee: UserRef | None
    automation_paused: bool
    last_message_at: datetime | None
    last_message_preview: str | None
    unread_count: int
    resolved_at: datetime | None
    created_at: datetime


class InboxCounts(BaseModel):
    mine: int
    unassigned: int
    open: int
    resolved: int


class AssignRequest(BaseModel):
    user_id: uuid.UUID | None  # null = unassign


class StatusRequest(BaseModel):
    status: ConversationStatus


class PriorityRequest(BaseModel):
    priority: Priority


class TakeoverRequest(BaseModel):
    automation_paused: bool


class NoteCreate(BaseModel):
    body: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=5000)]


class NoteOut(BaseModel):
    id: uuid.UUID
    body: str
    author: UserRef | None
    created_at: datetime


class AssignmentOut(BaseModel):
    assignee: UserRef | None
    assigned_by: UserRef | None
    created_at: datetime


class AttachmentOut(APIModel):
    id: uuid.UUID
    file_name: str
    content_type: str
    size_bytes: int


class MessageOut(BaseModel):
    id: uuid.UUID
    conversation_id: uuid.UUID
    direction: str
    message_type: str
    content: str | None
    status: str
    error: str | None
    sent_by: UserRef | None
    attachments: list[AttachmentOut]
    created_at: datetime
    status_updated_at: datetime | None


class AssigneeOption(BaseModel):
    id: uuid.UUID
    full_name: str
    email: str
    role_name: str
