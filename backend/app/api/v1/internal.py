"""Service-to-service endpoints. Authenticated with INTERNAL_API_TOKEN, never by user tokens.
In production these paths must not be routed from the public internet (see docs/SECURITY.md)."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Header
from sqlalchemy import text

from app.api.deps import DB
from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.schemas.channels import RestoreItem

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
