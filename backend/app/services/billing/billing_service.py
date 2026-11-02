"""High-level billing service managing customer portal, invoices, and cancellation lifecycle."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.commercial import InvoiceRecord, Subscription
from app.services.audit import record_audit
from app.services.billing.provider import BillingProvider
from app.services.billing.stripe_provider import StripeTestBillingProvider
from app.services.organizations import OrgContext
from app.services.plans import get_or_create_subscription

_provider: BillingProvider | None = None


def get_billing_provider() -> BillingProvider:
    global _provider
    if _provider is None:
        _provider = StripeTestBillingProvider()
    return _provider


async def list_invoices(db: AsyncSession, ctx: OrgContext) -> list[InvoiceRecord]:
    """List invoices for the active organization."""
    ctx.require("billing.read")
    res = await db.execute(
        select(InvoiceRecord)
        .where(InvoiceRecord.organization_id == ctx.org_id)
        .order_by(InvoiceRecord.created_at.desc())
    )
    return list(res.scalars().all())


async def cancel_subscription_at_period_end(
    db: AsyncSession,
    ctx: OrgContext,
) -> Subscription:
    """Schedule cancellation of subscription at the end of the current billing period."""
    ctx.require("billing.manage")
    ctx.require_not_suspended()

    sub = await get_or_create_subscription(db, ctx.org_id)
    sub.cancel_at_period_end = True

    record_audit(
        db,
        "billing.subscription_cancel_scheduled",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="subscription",
        target_id=sub.id,
        details={"cancel_at_period_end": True},
    )
    await db.flush()
    return sub


async def resume_subscription(
    db: AsyncSession,
    ctx: OrgContext,
) -> Subscription:
    """Resume a subscription scheduled for cancellation."""
    ctx.require("billing.manage")
    ctx.require_not_suspended()

    sub = await get_or_create_subscription(db, ctx.org_id)
    sub.cancel_at_period_end = False

    record_audit(
        db,
        "billing.subscription_resumed",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="subscription",
        target_id=sub.id,
        details={"cancel_at_period_end": False},
    )
    await db.flush()
    return sub
