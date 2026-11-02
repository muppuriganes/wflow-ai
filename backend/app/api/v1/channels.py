import uuid
from typing import Annotated

from fastapi import APIRouter, Query, status

from app.api.deps import DB, OrgCtx
from app.core.config import get_settings
from app.schemas.channels import (
    ChannelCapabilities,
    ConnectionCreate,
    ConnectionEventOut,
    ConnectionOut,
    QRCodeOut,
    SimulateInbound,
)
from app.schemas.common import Page
from app.services import channels as channel_service

router = APIRouter(prefix="/organizations/{org_id}", tags=["channels"])


@router.get("/channel-capabilities")
async def capabilities(ctx: OrgCtx) -> ChannelCapabilities:
    ctx.require("connections.read")
    settings = get_settings()
    types = ["whatsapp_web"] + (["simulator"] if settings.simulator_enabled else [])
    return ChannelCapabilities(
        channel_types=types,
        max_connections=settings.max_connections_per_org,
        send_limit_per_minute=settings.channel_send_limit_per_minute,
    )


@router.get("/connections")
async def list_connections(db: DB, ctx: OrgCtx) -> list[ConnectionOut]:
    return [ConnectionOut.model_validate(c) for c in await channel_service.list_connections(db, ctx)]


@router.post("/connections", status_code=status.HTTP_201_CREATED)
async def create_connection(data: ConnectionCreate, db: DB, ctx: OrgCtx) -> ConnectionOut:
    conn = await channel_service.create_connection(db, ctx, data.display_name, data.channel_type)
    return ConnectionOut.model_validate(conn)


@router.get("/connections/{connection_id}")
async def get_connection(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ConnectionOut:
    return ConnectionOut.model_validate(await channel_service.get_connection(db, ctx, connection_id))


@router.post("/connections/{connection_id}/initialize")
async def initialize(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ConnectionOut:
    """Starts the session; poll `/qr` and the connection status for progress."""
    return ConnectionOut.model_validate(await channel_service.start_connection(db, ctx, connection_id))


@router.post("/connections/{connection_id}/reconnect")
async def reconnect(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ConnectionOut:
    return ConnectionOut.model_validate(await channel_service.start_connection(db, ctx, connection_id))


@router.get("/connections/{connection_id}/qr")
async def get_qr(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> QRCodeOut:
    qr = await channel_service.get_qr(db, ctx, connection_id)
    return QRCodeOut(status=qr.status, qr_data_url=qr.qr_data_url, expires_in=qr.expires_in)


@router.post("/connections/{connection_id}/logout")
async def logout(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ConnectionOut:
    return ConnectionOut.model_validate(await channel_service.logout_connection(db, ctx, connection_id))


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await channel_service.remove_connection(db, ctx, connection_id)


@router.get("/connections/{connection_id}/events")
async def connection_events(
    connection_id: uuid.UUID,
    db: DB,
    ctx: OrgCtx,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page[ConnectionEventOut]:
    rows, total = await channel_service.list_connection_events(db, ctx, connection_id, page, page_size)
    return Page(
        items=[ConnectionEventOut.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/connections/{connection_id}/simulate/scan", status_code=status.HTTP_202_ACCEPTED)
async def simulate_scan(connection_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    """Development only: behaves as if the QR code was scanned on a phone."""
    await channel_service.simulate(db, ctx, connection_id, "scan", {})


@router.post("/connections/{connection_id}/simulate/inbound", status_code=status.HTTP_202_ACCEPTED)
async def simulate_inbound(connection_id: uuid.UUID, data: SimulateInbound, db: DB, ctx: OrgCtx) -> None:
    """Development only: injects a customer message through the full gateway -> event path."""
    await channel_service.simulate(db, ctx, connection_id, "inbound", data.model_dump())
