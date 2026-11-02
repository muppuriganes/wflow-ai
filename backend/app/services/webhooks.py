"""Outgoing webhook service with HMAC-SHA256 signing, SSRF validation, delivery logging, and auto-disabling."""

import hashlib
import hmac
import json
import secrets
import time
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AppError, NotFoundError
from app.core.logging import get_logger
from app.core.ssrf import SSRFProtectionError, check_url, read_limited, safe_client
from app.database.session import SessionFactory, set_rls_context
from app.models.commercial import WebhookDelivery, WebhookEndpoint
from app.schemas.commercial import WebhookCreateIn, WebhookUpdateIn
from app.services.audit import record_audit
from app.services.organizations import OrgContext

log = get_logger("services.webhooks")
MAX_CONSECUTIVE_FAILURES = 10


def sign_payload(secret: str, timestamp: int, body_str: str) -> str:
    """Compute HMAC-SHA256 signature for outgoing webhook payload."""
    data = f"{timestamp}.{body_str}".encode()
    sig = hmac.new(secret.encode("utf-8"), data, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


# Events an endpoint can subscribe to (and where each is emitted).
EVENT_TYPES = (
    "message.received",  # workers/channel_events
    "message.sent",  # services/messaging.deliver
    "contact.created",  # services/crm, workers/channel_events
    "lead.stage_changed",  # services/crm.update_lead
    "workflow.run.completed",  # workflow_engine/activities.set_run_state
    "workflow.run.failed",
)


def _check_events(events: list[str]) -> list[str]:
    unknown = sorted(set(events) - set(EVENT_TYPES))
    if unknown:
        raise AppError(f"Unknown webhook event(s): {', '.join(unknown)}", code="invalid_events")
    return sorted(set(events))


async def emit(org_id: uuid.UUID, event_type: str, data: dict[str, Any]) -> None:
    """Queues `event_type` for every active endpoint of the organization subscribed to it.

    Called after the change is committed. Delivery is durable (Temporal retries with backoff) and
    logged per attempt. This never raises: an outgoing webhook must not break the action that caused
    it; if queueing fails, a failed delivery is logged so the customer can see it and redeliver."""
    from app.workflow_engine import client as engine
    from app.workflow_engine.types import WebhookDeliveryInput

    try:
        async with SessionFactory() as db:
            await set_rls_context(db, user_id=None, org_id=org_id)
            endpoint_ids = (
                await db.scalars(
                    select(WebhookEndpoint.id).where(
                        WebhookEndpoint.organization_id == org_id,
                        WebhookEndpoint.is_active.is_(True),
                        WebhookEndpoint.events.contains([event_type]),
                    )
                )
            ).all()
            if not endpoint_ids:
                return
            event = {
                "id": f"evt_{uuid.uuid4().hex}",
                "type": event_type,
                "created_at": datetime.now(UTC).isoformat(),
                "organization_id": str(org_id),
                "data": data,
            }
            scale = get_settings().workflow_time_scale
            for endpoint_id in endpoint_ids:
                try:
                    await engine.start_webhook_delivery(
                        WebhookDeliveryInput(str(org_id), str(endpoint_id), event, scale)
                    )
                except Exception as exc:
                    db.add(WebhookDelivery(
                        organization_id=org_id, webhook_id=endpoint_id, event_type=event_type, event_id=event["id"],
                        payload=event, duration_ms=0, attempt=0, success=False,
                        error=f"Couldn't queue the delivery: {exc}"[:500],
                    ))  # fmt: skip
            await db.commit()
    except Exception:
        log.exception("webhook_emit_failed", org_id=str(org_id), event_type=event_type)


async def create_webhook(
    db: AsyncSession,
    ctx: OrgContext,
    data: WebhookCreateIn,
) -> tuple[WebhookEndpoint, str]:
    """Register an outgoing webhook endpoint."""
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    await check_url(data.target_url)

    secret_key = f"whsec_{secrets.token_urlsafe(32)}"
    endpoint = WebhookEndpoint(
        organization_id=ctx.org_id,
        name=data.name,
        target_url=data.target_url,
        secret_key=secret_key,
        events=_check_events(data.events),
        is_active=data.is_active,
        consecutive_failures=0,
    )
    db.add(endpoint)
    await db.flush()

    record_audit(
        db,
        "webhook.created",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="webhook",
        target_id=endpoint.id,
        details={"name": endpoint.name, "target_url": endpoint.target_url, "events": endpoint.events},
    )
    return endpoint, secret_key


async def list_webhooks(db: AsyncSession, ctx: OrgContext) -> list[WebhookEndpoint]:
    """List all webhook endpoints for an organization."""
    ctx.require("integrations.read")
    res = await db.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.organization_id == ctx.org_id)
        .order_by(WebhookEndpoint.created_at.desc())
    )
    return list(res.scalars().all())


async def get_webhook(db: AsyncSession, ctx: OrgContext, webhook_id: uuid.UUID) -> WebhookEndpoint:
    """Get a single webhook endpoint."""
    ctx.require("integrations.read")
    res = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == webhook_id,
            WebhookEndpoint.organization_id == ctx.org_id,
        )
    )
    endpoint = res.scalar_one_or_none()
    if not endpoint:
        raise NotFoundError("Webhook not found")
    return endpoint


async def update_webhook(
    db: AsyncSession,
    ctx: OrgContext,
    webhook_id: uuid.UUID,
    data: WebhookUpdateIn,
) -> WebhookEndpoint:
    """Update a webhook endpoint."""
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    endpoint = await get_webhook(db, ctx, webhook_id)

    if data.target_url is not None:
        await check_url(data.target_url)
        endpoint.target_url = data.target_url

    if data.name is not None:
        endpoint.name = data.name

    if data.events is not None:
        endpoint.events = _check_events(data.events)

    if data.is_active is not None:
        endpoint.is_active = data.is_active
        if data.is_active:
            endpoint.consecutive_failures = 0
            endpoint.disabled_reason = None

    await db.flush()
    record_audit(
        db,
        "webhook.updated",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="webhook",
        target_id=endpoint.id,
        details={"is_active": endpoint.is_active, "events": endpoint.events},
    )
    return endpoint


async def delete_webhook(db: AsyncSession, ctx: OrgContext, webhook_id: uuid.UUID) -> None:
    """Delete a webhook endpoint and its delivery logs."""
    ctx.require("integrations.manage")
    endpoint = await get_webhook(db, ctx, webhook_id)
    await db.delete(endpoint)
    await db.flush()
    record_audit(
        db,
        "webhook.deleted",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="webhook",
        target_id=webhook_id,
        details={},
    )


async def list_deliveries(
    db: AsyncSession,
    ctx: OrgContext,
    webhook_id: uuid.UUID,
    limit: int = 50,
) -> list[WebhookDelivery]:
    """List recent delivery logs for a webhook endpoint."""
    ctx.require("integrations.read")
    # Verify webhook exists in org
    await get_webhook(db, ctx, webhook_id)

    res = await db.execute(
        select(WebhookDelivery)
        .where(
            WebhookDelivery.webhook_id == webhook_id,
            WebhookDelivery.organization_id == ctx.org_id,
        )
        .order_by(WebhookDelivery.created_at.desc())
        .limit(limit)
    )
    return list(res.scalars().all())


async def deliver_webhook(
    db: AsyncSession,
    webhook: WebhookEndpoint,
    event_type: str,
    event_id: str,
    payload: dict[str, Any],
    attempt: int = 1,
) -> WebhookDelivery:
    """Attempt HTTP POST delivery of a webhook event and log the attempt."""
    if not webhook.is_active:
        delivery = WebhookDelivery(
            organization_id=webhook.organization_id,
            webhook_id=webhook.id,
            event_type=event_type,
            event_id=event_id,
            payload=payload,
            response_status=None,
            response_body=None,
            duration_ms=0,
            attempt=attempt,
            success=False,
            error="Webhook is inactive",
        )
        db.add(delivery)
        await db.flush()
        return delivery

    # The address may have changed since it was saved (and is checked again on connect).
    try:
        await check_url(webhook.target_url)
    except SSRFProtectionError as exc:
        delivery = WebhookDelivery(
            organization_id=webhook.organization_id,
            webhook_id=webhook.id,
            event_type=event_type,
            event_id=event_id,
            payload=payload,
            duration_ms=0,
            attempt=attempt,
            success=False,
            error=f"SSRF violation: {exc.message}",
        )
        db.add(delivery)
        await db.flush()
        return delivery

    body_str = json.dumps(payload, separators=(",", ":"), default=str)
    timestamp = int(time.time())
    signature = sign_payload(webhook.secret_key, timestamp, body_str)

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "WFlow-Webhook/1.0",
        "X-WFlow-Signature": signature,
        "X-WFlow-Timestamp": str(timestamp),
        "X-WFlow-Event": event_type,
        "X-WFlow-Delivery": event_id,
    }

    start_time = time.perf_counter()
    status_code: int | None = None
    response_body_text: str | None = None
    error_msg: str | None = None
    success = False

    try:
        async with (
            safe_client(timeout=10.0) as client,
            client.stream("POST", webhook.target_url, content=body_str, headers=headers) as resp,
        ):
            status_code = resp.status_code
            response_body_text = (await read_limited(resp, 4096))[0][:1500]
            success = 200 <= status_code < 300
            if not success:
                error_msg = f"HTTP status {status_code}"
    except SSRFProtectionError as exc:
        error_msg = f"SSRF violation: {exc.message}"
    except httpx.HTTPError as exc:
        error_msg = f"{type(exc).__name__}: {exc}"[:500] or type(exc).__name__

    duration_ms = int((time.perf_counter() - start_time) * 1000)

    delivery = WebhookDelivery(
        organization_id=webhook.organization_id,
        webhook_id=webhook.id,
        event_type=event_type,
        event_id=event_id,
        payload=payload,
        response_status=status_code,
        response_body=response_body_text,
        duration_ms=duration_ms,
        attempt=attempt,
        success=success,
        error=error_msg,
    )
    db.add(delivery)

    # Atomic, because parallel deliveries to the same endpoint update the same counter.
    await db.flush()
    failures = await db.scalar(
        update(WebhookEndpoint)
        .where(WebhookEndpoint.id == webhook.id)
        .values(consecutive_failures=0 if success else WebhookEndpoint.consecutive_failures + 1)
        .returning(WebhookEndpoint.consecutive_failures)
    )
    if not success and (failures or 0) >= MAX_CONSECUTIVE_FAILURES:
        await db.execute(
            update(WebhookEndpoint)
            .where(WebhookEndpoint.id == webhook.id, WebhookEndpoint.is_active.is_(True))
            .values(is_active=False,
                    disabled_reason=f"Auto-disabled after {MAX_CONSECUTIVE_FAILURES} consecutive delivery failures")
        )  # fmt: skip
    await db.refresh(webhook)
    return delivery


async def ping_webhook(
    db: AsyncSession,
    ctx: OrgContext,
    webhook_id: uuid.UUID,
) -> WebhookDelivery:
    """Send a test ping event to the webhook endpoint."""
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    endpoint = await get_webhook(db, ctx, webhook_id)
    event_id = f"evt_{uuid.uuid4().hex[:16]}"
    payload = {
        "event": "webhook.ping",
        "message": "Test ping from WFlow AI",
        "timestamp": int(time.time()),
        "organization_id": str(ctx.org_id),
    }
    return await deliver_webhook(db, endpoint, "webhook.ping", event_id, payload, attempt=1)


async def redeliver_delivery(
    db: AsyncSession,
    ctx: OrgContext,
    webhook_id: uuid.UUID,
    delivery_id: uuid.UUID,
) -> WebhookDelivery:
    """Retry an existing delivery."""
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    endpoint = await get_webhook(db, ctx, webhook_id)

    res = await db.execute(
        select(WebhookDelivery).where(
            WebhookDelivery.id == delivery_id,
            WebhookDelivery.webhook_id == webhook_id,
            WebhookDelivery.organization_id == ctx.org_id,
        )
    )
    prev = res.scalar_one_or_none()
    if not prev:
        raise NotFoundError("Delivery not found")

    return await deliver_webhook(
        db,
        endpoint,
        prev.event_type,
        prev.event_id,
        prev.payload,
        attempt=prev.attempt + 1,
    )
