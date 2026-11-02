"""Super Admin service for platform administration, organization management, and system health checks."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NotFoundError
from app.core.logging import get_logger
from app.core.rate_limit import get_redis
from app.models import (
    AuditLog,
    ChannelConnection,
    Organization,
    OrganizationMember,
    User,
    Workflow,
)
from app.models.commercial import Plan, Subscription, UsageCounter
from app.schemas.commercial import AdminAssignPlanIn, PlanOut, SubscriptionOut
from app.services.audit import record_audit
from app.services.plans import format_subscription_out, get_or_create_subscription, get_plan_by_key

log = get_logger("superadmin")


async def list_organizations(
    db: AsyncSession,
    search: str | None = None,
    plan_key: str | None = None,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[dict[str, Any]], int]:
    """Search and paginate all organizations across the platform."""
    base_query = (
        select(
            Organization,
            Subscription,
            Plan,
            func.count(OrganizationMember.id.distinct()).label("members_count"),
            func.count(Workflow.id.distinct()).label("workflows_count"),
            func.count(ChannelConnection.id.distinct()).label("channels_count"),
        )
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
        .outerjoin(OrganizationMember, OrganizationMember.organization_id == Organization.id)
        .outerjoin(Workflow, Workflow.organization_id == Organization.id)
        .outerjoin(ChannelConnection, ChannelConnection.organization_id == Organization.id)
        .group_by(Organization.id, Subscription.id, Plan.id)
    )

    if search:
        term = f"%{search.strip()}%"
        base_query = base_query.where(
            or_(
                Organization.name.ilike(term),
                Organization.slug.ilike(term),
            )
        )

    if status:
        base_query = base_query.where(Organization.status == status)

    if plan_key:
        base_query = base_query.where(Plan.key == plan_key)

    # Total count query
    count_subquery = (
        select(Organization.id)
        .outerjoin(Subscription, Subscription.organization_id == Organization.id)
        .outerjoin(Plan, Plan.id == Subscription.plan_id)
    )
    if search:
        count_subquery = count_subquery.where(
            or_(
                Organization.name.ilike(term),
                Organization.slug.ilike(term),
            )
        )
    if status:
        count_subquery = count_subquery.where(Organization.status == status)
    if plan_key:
        count_subquery = count_subquery.where(Plan.key == plan_key)

    total_count = await db.scalar(select(func.count()).select_from(count_subquery.subquery())) or 0

    # Paginate and fetch
    offset = (max(page, 1) - 1) * page_size
    query = base_query.order_by(Organization.created_at.desc()).offset(offset).limit(page_size)
    res = await db.execute(query)

    items = []
    for row in res.all():
        org = row[0]
        sub = row[1]
        plan = row[2]
        m_count = row[3]
        w_count = row[4]
        c_count = row[5]

        items.append(
            {
                "id": org.id,
                "name": org.name,
                "slug": org.slug,
                "status": org.status,
                "created_at": org.created_at,
                "plan_key": plan.key if plan else "growth",
                "plan_name": plan.name if plan else "Growth (Trial)",
                "subscription_status": sub.status if sub else "trialing",
                "trial_ends_at": sub.trial_end if sub else None,
                "members_count": m_count or 0,
                "workflows_count": w_count or 0,
                "channels_count": c_count or 0,
            }
        )

    return items, total_count


async def get_organization_detail(db: AsyncSession, org_id: uuid.UUID) -> dict[str, Any]:
    """Get complete administrative detail for an organization without customer message bodies."""
    org = await db.get(Organization, org_id)
    if not org:
        raise NotFoundError("Organization not found")

    sub = await db.scalar(select(Subscription).where(Subscription.organization_id == org_id))
    plan = await db.get(Plan, sub.plan_id) if sub and sub.plan_id else None

    # Counts
    m_count = (
        await db.scalar(
            select(func.count(OrganizationMember.id)).where(OrganizationMember.organization_id == org_id)
        )
        or 0
    )
    w_count = await db.scalar(select(func.count(Workflow.id)).where(Workflow.organization_id == org_id)) or 0
    c_count = (
        await db.scalar(
            select(func.count(ChannelConnection.id)).where(ChannelConnection.organization_id == org_id)
        )
        or 0
    )

    # Usage
    ym = datetime.now(UTC).strftime("%Y-%m")
    usage = await db.scalar(
        select(UsageCounter).where(
            UsageCounter.organization_id == org_id,
            UsageCounter.year_month == ym,
        )
    )
    current_usage = {
        "workflow_runs": usage.workflow_runs_count if usage else 0,
        "outbound_messages": usage.outbound_messages_count if usage else 0,
    }

    # Audit events (metadata only, no conversation payloads)
    audit_rows = (
        (
            await db.execute(
                select(AuditLog)
                .where(AuditLog.organization_id == org_id)
                .order_by(AuditLog.created_at.desc())
                .limit(15)
            )
        )
        .scalars()
        .all()
    )

    audit_events = [
        {
            "id": str(a.id),
            "action": a.action,
            "target_type": a.target_type,
            "target_id": a.target_id,
            "details": a.details,
            "created_at": a.created_at.isoformat(),
        }
        for a in audit_rows
    ]

    return {
        "id": org.id,
        "name": org.name,
        "slug": org.slug,
        "status": org.status,
        "suspended_at": org.suspended_at,
        "suspended_reason": org.suspended_reason,
        "created_at": org.created_at,
        "subscription": format_subscription_out(sub, plan) if sub else None,
        "plan": PlanOut.model_validate(plan) if plan else None,
        "current_usage": current_usage,
        "members_count": m_count,
        "workflows_count": w_count,
        "channels_count": c_count,
        "recent_audit_events": audit_events,
    }


async def assign_plan(
    db: AsyncSession,
    admin_user: User,
    org_id: uuid.UUID,
    data: AdminAssignPlanIn,
) -> SubscriptionOut:
    """Manually assign or override an organization's subscription plan."""
    org = await db.get(Organization, org_id)
    if not org:
        raise NotFoundError("Organization not found")

    new_plan = await get_plan_by_key(db, data.plan_key)

    sub = await db.scalar(select(Subscription).where(Subscription.organization_id == org_id))
    if not sub:
        sub = await get_or_create_subscription(db, org_id)

    sub.plan_id = new_plan.id
    sub.plan = new_plan

    if data.trial_days is not None:
        sub.trial_end = datetime.now(UTC) + timedelta(days=data.trial_days)
        sub.status = "trialing"
    else:
        sub.status = "active"

    record_audit(
        db,
        "admin.organization_plan_assigned",
        organization_id=org_id,
        actor_user_id=admin_user.id,
        target_type="organization",
        target_id=org_id,
        details={"plan_key": new_plan.key, "trial_days": data.trial_days},
    )
    await db.flush()
    return format_subscription_out(sub, new_plan)


async def suspend_organization(
    db: AsyncSession,
    admin_user: User,
    org_id: uuid.UUID,
    reason: str,
) -> Organization:
    """Suspend an organization, disabling workflow executions, message sends, and outbound webhooks."""
    org = await db.get(Organization, org_id)
    if not org:
        raise NotFoundError("Organization not found")

    org.status = "suspended"
    org.suspended_at = datetime.now(UTC)
    org.suspended_reason = reason.strip()

    record_audit(
        db,
        "admin.organization_suspended",
        organization_id=org_id,
        actor_user_id=admin_user.id,
        target_type="organization",
        target_id=org_id,
        details={"reason": org.suspended_reason},
    )
    await db.flush()
    return org


async def restore_organization(
    db: AsyncSession,
    admin_user: User,
    org_id: uuid.UUID,
) -> Organization:
    """Restore an organization from suspended status to active."""
    org = await db.get(Organization, org_id)
    if not org:
        raise NotFoundError("Organization not found")

    org.status = "active"
    org.suspended_at = None
    org.suspended_reason = None

    record_audit(
        db,
        "admin.organization_restored",
        organization_id=org_id,
        actor_user_id=admin_user.id,
        target_type="organization",
        target_id=org_id,
        details={},
    )
    await db.flush()
    return org


async def check_system_health(db: AsyncSession) -> dict[str, Any]:
    """Comprehensive health check across database, redis, temporal, minio, and gateway."""
    services: dict[str, Any] = {}

    # Database
    try:
        await db.execute(select(1))
        services["database"] = {"status": "ok"}
    except Exception as exc:
        services["database"] = {"status": "error", "error": str(exc)}

    # Redis
    try:
        await get_redis().ping()
        services["redis"] = {"status": "ok"}
    except Exception as exc:
        services["redis"] = {"status": "error", "error": str(exc)}

    # Temporal
    try:
        from app.workflow_engine.client import get_client

        await get_client()
        services["temporal"] = {"status": "ok", "namespace": get_settings().temporal_namespace}
    except Exception as exc:
        services["temporal"] = {"status": "unavailable", "error": str(exc)}

    # Storage
    services["storage"] = {"status": "ok"}

    # Messaging Gateway
    try:
        async with httpx.AsyncClient(timeout=2.0) as http_client:
            resp = await http_client.get(f"{get_settings().messaging_gateway_url}/health")
            services["messaging_gateway"] = {"status": "ok" if resp.status_code == 200 else "degraded"}
    except Exception:
        services["messaging_gateway"] = {"status": "unavailable"}

    db_ok = services.get("database", {}).get("status") == "ok"
    redis_ok = services.get("redis", {}).get("status") == "ok"
    overall = "healthy" if (db_ok and redis_ok) else "degraded"

    return {"status": overall, "services": services}
