import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.core.rate_limit import get_redis
from app.models import ChannelConnection, ChannelEvent
from app.services.audit import record_audit
from app.services.gateway import GatewayUnavailableError, get_gateway
from app.services.organizations import OrgContext

log = get_logger(__name__)

# States from which a (re)connect may be started.
STARTABLE = {"NOT_CONNECTED", "DISCONNECTED", "ERROR", "LOGGED_OUT"}
# States in which the gateway holds a live (or starting) session.
ACTIVE = {"INITIALIZING", "QR_PENDING", "AUTHENTICATING", "CONNECTED", "RECONNECTING"}


def qr_key(connection_id: uuid.UUID) -> str:
    """Written by the gateway with a short TTL. QR codes are never put on the event stream:
    a QR grants device linking, so it lives only briefly and is served only to managers."""
    return f"wflow:gw:qr:{connection_id}"


@dataclass
class QRCode:
    status: str
    qr_data_url: str | None
    expires_in: int | None


async def list_connections(db: AsyncSession, ctx: OrgContext) -> list[ChannelConnection]:
    ctx.require("connections.read")
    rows = await db.scalars(
        select(ChannelConnection)
        .where(ChannelConnection.organization_id == ctx.org_id, ChannelConnection.deleted_at.is_(None))
        .order_by(ChannelConnection.created_at)
    )
    return list(rows.all())


async def get_connection(db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> ChannelConnection:
    ctx.require("connections.read")
    conn = await db.scalar(
        select(ChannelConnection).where(
            ChannelConnection.id == connection_id,
            ChannelConnection.organization_id == ctx.org_id,
            ChannelConnection.deleted_at.is_(None),
        )
    )
    if conn is None:
        raise NotFoundError("Connection not found")
    return conn


async def create_connection(
    db: AsyncSession, ctx: OrgContext, display_name: str, channel_type: str
) -> ChannelConnection:
    ctx.require("connections.manage")
    settings = get_settings()
    if channel_type == "simulator" and not settings.simulator_enabled:
        raise AppError("The simulator channel is disabled on this server", code="channel_unavailable")
    count = await db.scalar(
        select(func.count())
        .select_from(ChannelConnection)
        .where(ChannelConnection.organization_id == ctx.org_id, ChannelConnection.deleted_at.is_(None))
    )
    if (count or 0) >= settings.max_connections_per_org:
        raise ConflictError(
            f"Your plan allows {settings.max_connections_per_org} connections. Remove one to add another.",
            code="connection_limit",
        )
    conn = ChannelConnection(
        id=uuid.uuid4(),
        organization_id=ctx.org_id,
        channel_type=channel_type,
        display_name=display_name,
        created_by_user_id=ctx.user.id,
    )
    db.add(conn)
    record_audit(
        db,
        "connection.created",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="connection",
        target_id=conn.id,
        details={"name": display_name, "channel_type": channel_type},
    )
    await db.commit()
    await db.refresh(conn)
    return conn


async def start_connection(db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> ChannelConnection:
    """Starts (or restarts) the gateway session. Status updates then arrive as events."""
    ctx.require("connections.manage")
    conn = await get_connection(db, ctx, connection_id)
    if conn.status not in STARTABLE:
        raise ConflictError(
            f"Connection is already {conn.status.lower().replace('_', ' ')}", code="invalid_state"
        )
    previous = conn.status
    # A new QR link starts from an empty browser profile; a previously connected session resumes.
    fresh = conn.last_connected_at is None or previous == "LOGGED_OUT"
    conn.status = "INITIALIZING" if previous in {"NOT_CONNECTED", "LOGGED_OUT"} else "RECONNECTING"
    conn.status_detail = None
    conn.session_reference = conn.session_reference or f"{conn.organization_id}/{conn.id}"
    record_audit(
        db,
        "connection.started" if previous in {"NOT_CONNECTED", "LOGGED_OUT"} else "connection.reconnect",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="connection",
        target_id=conn.id,
    )
    await db.commit()
    try:
        await get_gateway().start(conn.id, conn.organization_id, conn.channel_type, fresh)
    except GatewayUnavailableError:
        conn.status = "ERROR"
        conn.status_detail = "Messaging service unreachable"
        await db.commit()
        raise
    await db.refresh(conn)
    return conn


async def get_qr(db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> QRCode:
    ctx.require("connections.manage")
    conn = await get_connection(db, ctx, connection_id)
    if conn.status != "QR_PENDING":
        return QRCode(status=conn.status, qr_data_url=None, expires_in=None)
    try:
        redis = get_redis()
        key = qr_key(conn.id)
        qr = await redis.get(key)
        ttl = await redis.ttl(key) if qr else None
    except RedisError:
        log.error("qr_read_failed", connection_id=str(conn.id))
        raise AppError("QR code temporarily unavailable", code="qr_unavailable") from None
    return QRCode(status=conn.status, qr_data_url=qr, expires_in=ttl if ttl and ttl > 0 else None)


async def logout_connection(db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> ChannelConnection:
    """Unlinks the device from WhatsApp and deletes the stored session."""
    ctx.require("connections.manage")
    conn = await get_connection(db, ctx, connection_id)
    if conn.status in ACTIVE:
        await get_gateway().logout(conn.id)
    conn.status = "LOGGED_OUT"
    conn.status_detail = "Logged out by a team member"
    conn.last_disconnected_at = datetime.now(UTC)
    record_audit(
        db,
        "connection.logged_out",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="connection",
        target_id=conn.id,
    )
    await db.commit()
    await db.refresh(conn)
    return conn


async def remove_connection(db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID) -> None:
    """Secure cleanup first (gateway logs out and wipes session data), then soft-delete.
    If the gateway cannot confirm the wipe, nothing is deleted so the user can retry."""
    ctx.require("connections.manage")
    conn = await get_connection(db, ctx, connection_id)
    await get_gateway().remove(conn.id, conn.organization_id)
    conn.deleted_at = datetime.now(UTC)
    conn.status = "LOGGED_OUT"
    conn.session_reference = None
    record_audit(
        db,
        "connection.removed",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="connection",
        target_id=conn.id,
        details={"name": conn.display_name},
    )
    await db.commit()


async def list_connection_events(
    db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, page: int, page_size: int
) -> tuple[list[ChannelEvent], int]:
    conn = await get_connection(db, ctx, connection_id)
    where = (ChannelEvent.connection_id == conn.id, ChannelEvent.organization_id == ctx.org_id)
    total = await db.scalar(select(func.count()).select_from(ChannelEvent).where(*where)) or 0
    rows = await db.scalars(
        select(ChannelEvent)
        .where(*where)
        .order_by(ChannelEvent.occurred_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return list(rows.all()), total


async def simulate(
    db: AsyncSession, ctx: OrgContext, connection_id: uuid.UUID, action: str, payload: dict[str, str]
) -> None:
    ctx.require("connections.manage")
    if not get_settings().simulator_enabled:
        raise AppError("The simulator is disabled on this server", code="channel_unavailable")
    conn = await get_connection(db, ctx, connection_id)
    if conn.channel_type != "simulator":
        raise AppError("Only simulator connections can be simulated", code="not_simulator")
    await get_gateway().simulate(conn.id, action, payload)
