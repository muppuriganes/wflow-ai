"""Service-to-service endpoints. Authenticated with INTERNAL_API_TOKEN, never by user tokens.
In production these paths must not be routed from the public internet (see docs/SECURITY.md)."""

import hmac
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Header, UploadFile
from sqlalchemy import select, text

from app.api.deps import DB
from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError, NotFoundError
from app.database.session import set_rls_context
from app.models import ChannelConnection, MessageAttachment
from app.schemas.channels import RestoreItem
from app.services.files import MAX_ATTACHMENT_BYTES, validate_upload
from app.services.storage import attachment_key, get_storage

router = APIRouter(prefix="/internal", tags=["internal"], include_in_schema=False)


async def require_internal_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = get_settings().internal_api_token
    provided = (authorization or "").removeprefix("Bearer ").strip()
    if not expected or not hmac.compare_digest(provided.encode(), expected.encode()):
        raise AuthenticationError("Invalid internal token")


@router.get("/channels/restore", dependencies=[Depends(require_internal_token)])
async def connections_to_restore(db: DB) -> list[RestoreItem]:
    """Sessions the gateway should resume after it restarts (across all tenants)."""
    rows = await db.execute(
        text("SELECT id, organization_id, channel_type FROM channel_connections_to_restore()")
    )
    return [
        RestoreItem(connection_id=r.id, organization_id=r.organization_id, channel_type=r.channel_type)
        for r in rows
    ]


@router.post("/channels/media", dependencies=[Depends(require_internal_token)])
async def upload_inbound_media(
    db: DB,
    organization_id: Annotated[uuid.UUID, Form()],
    connection_id: Annotated[uuid.UUID, Form()],
    file: Annotated[UploadFile, File()],
) -> dict[str, str]:
    """The gateway uploads media from an incoming message here, then references the returned
    attachment_id in its message.received event. Validated exactly like user uploads."""
    await set_rls_context(db, user_id=None, org_id=organization_id)
    conn = await db.scalar(
        select(ChannelConnection.id).where(
            ChannelConnection.id == connection_id, ChannelConnection.organization_id == organization_id
        )
    )
    if conn is None:
        raise NotFoundError("Connection not found")
    data = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(data) > MAX_ATTACHMENT_BYTES:
        raise AppError("File too large", code="file_too_large")
    detected, safe_name = validate_upload(data, file.filename or "file")
    key = attachment_key(organization_id, safe_name)
    await get_storage().put(key, data, detected.content_type)
    att = MessageAttachment(
        id=uuid.uuid4(), organization_id=organization_id, message_id=None, storage_key=key,
        file_name=safe_name, content_type=detected.content_type, size_bytes=len(data), created_at=datetime.now(UTC),
    )  # fmt: skip
    db.add(att)
    await db.commit()
    return {"attachment_id": str(att.id), "message_type": detected.message_type}
