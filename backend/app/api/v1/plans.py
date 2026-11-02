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
    """Switch to a free plan (owner only). Paid plans go through billing checkout."""
    ctx.require("billing.manage")
    ctx.require_not_suspended()
    await svc.change_plan_self_service(db, ctx.org_id, ctx.user.id, data.plan_key, data.billing_interval)
    await db.commit()

    return await svc.get_usage_overview(db, ctx.org_id)
