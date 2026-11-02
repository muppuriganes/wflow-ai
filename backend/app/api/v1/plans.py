from fastapi import APIRouter

from app.api.deps import DB, OrgCtx
from app.schemas.commercial import ChangePlanIn, PlanOut, PlanUsageOverview
from app.services import plans as svc

router = APIRouter(prefix="/organizations/{org_id}/plans", tags=["plans"])


@router.get("")
async def list_available_plans(db: DB, ctx: OrgCtx) -> list[PlanOut]:
    """List all available subscription plans."""
    ctx.require("org.read")
    plans = await svc.list_plans(db)
    return [PlanOut.model_validate(p) for p in plans]


@router.get("/usage")
async def get_plan_usage(db: DB, ctx: OrgCtx) -> PlanUsageOverview:
    """Get current plan, subscription status, trial countdown, and resource meters."""
    ctx.require("org.read")
    return await svc.get_usage_overview(db, ctx.org_id)


@router.post("/change")
async def change_plan(data: ChangePlanIn, db: DB, ctx: OrgCtx) -> PlanUsageOverview:
    """Change the organization's plan (owner only)."""
    ctx.require("billing.manage")
    sub = await svc.get_or_create_subscription(db, ctx.org_id)
    new_plan = await svc.get_plan_by_key(db, data.plan_key)

    sub.plan_id = new_plan.id
    sub.plan = new_plan
    sub.billing_interval = data.billing_interval
    # If upgrading from free or expired trial, set to active
    if sub.status in ("trialing", "canceled"):
        sub.status = "active"
    await db.commit()

    return await svc.get_usage_overview(db, ctx.org_id)
