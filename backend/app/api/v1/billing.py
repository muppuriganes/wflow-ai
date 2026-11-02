"""Billing API: checkout sessions, portal, invoices, cancellation, and provider webhooks."""

import uuid

from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_org_context
from app.core.errors import AuthenticationError
from app.schemas.commercial import CheckoutIn, InvoiceOut, PortalIn, SubscriptionOut
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

    provider = billing_service.get_billing_provider()
    checkout_url = await provider.create_checkout_session(
        db,
        org_id=ctx.org_id,
        user_email=ctx.user.email,
        plan_key=data.plan_key,
        return_url=data.return_url,
    )
    return {"checkout_url": checkout_url}


@router.post("/organizations/{org_id}/billing/portal")
async def create_portal(
    org_id: uuid.UUID,
    data: PortalIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    ctx.require("billing.manage")
    ctx.require_not_suspended()

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
