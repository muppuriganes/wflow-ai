"""Normalized channel events produced by the messaging gateway.

The same contract is implemented in services/messaging-gateway/src/events/types.ts. Every
channel (WhatsApp Web today, others later) must emit exactly these shapes, so nothing
downstream depends on a specific provider.
"""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Status = Literal[
    "NOT_CONNECTED",
    "INITIALIZING",
    "QR_PENDING",
    "AUTHENTICATING",
    "CONNECTED",
    "DISCONNECTED",
    "RECONNECTING",
    "ERROR",
    "LOGGED_OUT",
]


class _Envelope(BaseModel):
    event_id: uuid.UUID
    organization_id: uuid.UUID
    connection_id: uuid.UUID
    occurred_at: datetime


class ConnectionStatePayload(BaseModel):
    status: Status
    detail: str | None = Field(default=None, max_length=500)
    phone_number: str | None = Field(default=None, max_length=32)
    account_name: str | None = Field(default=None, max_length=200)


class ConnectionStateEvent(_Envelope):
    event_type: Literal["connection.state"]
    payload: ConnectionStatePayload


class AttachmentRef(BaseModel):
    """A file the gateway already uploaded through /internal/channels/media."""

    attachment_id: uuid.UUID


class MessageReceivedPayload(BaseModel):
    provider_message_id: str = Field(max_length=200)
    chat_id: str = Field(max_length=100)
    sender: str = Field(max_length=100)
    sender_name: str | None = Field(default=None, max_length=200)
    sender_phone: str | None = Field(default=None, max_length=32)
    message_type: str = Field(max_length=30)
    content: str | None = Field(default=None, max_length=65536)
    is_group: bool = False
    provider_timestamp: datetime | None = None
    attachment: AttachmentRef | None = None


class MessageReceivedEvent(_Envelope):
    event_type: Literal["message.received"]
    payload: MessageReceivedPayload


class MessageSentPayload(BaseModel):
    provider_message_id: str = Field(max_length=200)
    client_message_id: str = Field(max_length=64)


class MessageSentEvent(_Envelope):
    event_type: Literal["message.sent"]
    payload: MessageSentPayload


class MessageAckPayload(BaseModel):
    provider_message_id: str = Field(max_length=200)
    # Only states the library actually reports; nothing is inferred.
    status: Literal["sent", "delivered", "read", "played", "failed"]


class MessageAckEvent(_Envelope):
    event_type: Literal["message.ack"]
    payload: MessageAckPayload


ChannelEvent = Annotated[
    ConnectionStateEvent | MessageReceivedEvent | MessageSentEvent | MessageAckEvent,
    Field(discriminator="event_type"),
]
