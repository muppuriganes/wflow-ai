"""Billing API: checkout sessions, portal, invoices, cancellation, and provider webhooks."""

import uuid

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_org_context
from app.core.config import get_settings
from app.core.errors import AppError, AuthenticationError
from app.database.session import get_db
from app.schemas.commercial import CheckoutConfirmIn, CheckoutIn, InvoiceOut, PortalIn, SubscriptionOut
from app.services.billing import billing_service
from app.services.organizations import OrgContext
from app.services.plans import format_subscription_out

router = APIRouter()


@router.post("/organizations/{org_id}/billing/checkout")
async def create_checkout(
    org_id: uuid.UUID,
    data: CheckoutIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    ctx.require("billing.manage")
    ctx.require_not_suspended()

    _require_app_url(data.return_url)
    if not get_settings().billing_test_mode:
        # Only the test provider exists so far; never pretend a live payment can be taken.
        raise AppError(
            "Online payments are not set up yet. Contact support to upgrade.", code="billing_unavailable"
        )
    provider = billing_service.get_billing_provider()
    checkout_url = await provider.create_checkout_session(
        db,
        org_id=ctx.org_id,
        user_email=ctx.user.email,
        plan_key=data.plan_key,
        return_url=data.return_url,
        interval=data.billing_interval,
    )
    return {"checkout_url": checkout_url}


@router.post("/organizations/{org_id}/billing/checkout/confirm", response_model=SubscriptionOut)
async def confirm_test_checkout(
    org_id: uuid.UUID,
    data: CheckoutConfirmIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    """Test mode only: completes the checkout the Billing page returns from."""
    sub = await billing_service.confirm_test_checkout(db, ctx, data.session_id)
    await db.commit()
    return format_subscription_out(sub)


def _require_app_url(url: str) -> None:
    """Return URLs must point back to this app (no open redirects through checkout)."""
    if not any(url == o or url.startswith(o.rstrip("/") + "/") for o in get_settings().cors_origin_list):
        raise AppError("The return address must be a page of this app", code="invalid_return_url")


@router.post("/organizations/{org_id}/billing/portal")
async def create_portal(
    org_id: uuid.UUID,
    data: PortalIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    ctx.require("billing.manage")
    ctx.require_not_suspended()

    _require_app_url(data.return_url)
    provider = billing_service.get_billing_provider()
    portal_url = await provider.create_customer_portal_session(
        db,
        org_id=ctx.org_id,
        return_url=data.return_url,
    )
    return {"portal_url": portal_url}


@router.get("/organizations/{org_id}/billing/invoices", response_model=list[InvoiceOut])
async def list_invoices(
    org_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> list[InvoiceOut]:
    items = await billing_service.list_invoices(db, ctx)
    return [InvoiceOut.model_validate(x) for x in items]


@router.post("/organizations/{org_id}/billing/cancel", response_model=SubscriptionOut)
async def cancel_subscription(
    org_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    sub = await billing_service.cancel_subscription_at_period_end(db, ctx)
    await db.commit()
    return format_subscription_out(sub)


@router.post("/organizations/{org_id}/billing/resume", response_model=SubscriptionOut)
async def resume_subscription(
    org_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOut:
    sub = await billing_service.resume_subscription(db, ctx)
    await db.commit()
    return format_subscription_out(sub)


# --- Public Webhook Endpoint --------------------------------------------------


@router.post("/billing/webhook/stripe")
async def handle_stripe_webhook(
    request: Request,
    stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
    db: AsyncSession = Depends(get_db),
) -> dict[str, bool]:
    if not stripe_signature:
        raise AuthenticationError("Missing Stripe-Signature header")

    body_bytes = await request.body()
    provider = billing_service.get_billing_provider()
    event_dict = provider.verify_webhook_signature(body_bytes, stripe_signature)

    await provider.process_webhook_event(db, event_dict)
    await db.commit()
    return {"received": True}
