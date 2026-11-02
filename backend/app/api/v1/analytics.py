from datetime import datetime

from fastapi import APIRouter, Response

from app.api.deps import DB, OrgCtx
from app.schemas.analytics import AnalyticsDataOut, AnalyticsOverviewOut
from app.services import analytics as svc

router = APIRouter(prefix="/organizations/{org_id}/analytics", tags=["analytics"])


@router.get("/overview")
async def get_overview(db: DB, ctx: OrgCtx) -> AnalyticsOverviewOut:
    ctx.require_any("analytics.read", "org.read")
    return await svc.get_overview_metrics(db, ctx.org_id)


@router.get("")
async def get_full_analytics(
    db: DB,
    ctx: OrgCtx,
    range: str = "7d",
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> AnalyticsDataOut:
    ctx.require("analytics.read")
    return await svc.get_full_analytics(db, ctx.org_id, range, from_date, to_date)


@router.get("/export")
async def export_csv(
    db: DB,
    ctx: OrgCtx,
    type: str = "conversations",
    range: str = "30d",
) -> Response:
    ctx.require("analytics.read")
    content = await svc.export_csv(db, ctx.org_id, type, range)
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="analytics-{type}.csv"'},
    )
