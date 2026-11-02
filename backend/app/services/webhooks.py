"""Outgoing webhook service with HMAC-SHA256 signing, SSRF validation, delivery logging, and auto-disabling."""

import hashlib
import hmac
import json
import secrets
import time
import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.core.ssrf import SSRFProtectionError, validate_url_ssrf_safe
from app.models.commercial import WebhookDelivery, WebhookEndpoint
from app.schemas.commercial import WebhookCreateIn, WebhookUpdateIn
from app.services.audit import record_audit
from app.services.organizations import OrgContext


def sign_payload(secret: str, timestamp: int, body_str: str) -> str:
    """Compute HMAC-SHA256 signature for outgoing webhook payload."""
    data = f"{timestamp}.{body_str}".encode()
    sig = hmac.new(secret.encode("utf-8"), data, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


async def create_webhook(
    db: AsyncSession,
    ctx: OrgContext,
    data: WebhookCreateIn,
) -> tuple[WebhookEndpoint, str]:
    """Register an outgoing webhook endpoint."""
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    # SSRF protection
    validate_url_ssrf_safe(data.target_url)

    secret_key = f"whsec_{secrets.token_urlsafe(32)}"
    endpoint = WebhookEndpoint(
        organization_id=ctx.org_id,
        name=data.name,
        target_url=data.target_url,
        secret_key=secret_key,
        events=data.events,
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
        validate_url_ssrf_safe(data.target_url)
        endpoint.target_url = data.target_url

    if data.name is not None:
        endpoint.name = data.name

    if data.events is not None:
        endpoint.events = data.events

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

    # Validate target url again
    try:
        validate_url_ssrf_safe(webhook.target_url)
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
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=False) as client:
            resp = await client.post(webhook.target_url, content=body_str, headers=headers)
            status_code = resp.status_code
            response_body_text = resp.text[:1500]
            success = 200 <= status_code < 300
            if not success:
                error_msg = f"HTTP status {status_code}"
    except Exception as exc:
        error_msg = str(exc)
        success = False

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

    if success:
        webhook.consecutive_failures = 0
        webhook.disabled_reason = None
    else:
        webhook.consecutive_failures += 1
        if webhook.consecutive_failures >= 10:
            webhook.is_active = False
            webhook.disabled_reason = "Auto-disabled after 10 consecutive delivery failures"

    await db.flush()
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
