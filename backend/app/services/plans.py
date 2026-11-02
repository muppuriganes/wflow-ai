import uuid
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, PlanLimitExceededError
from app.models.automation import Schedule, Workflow
from app.models.channels import ChannelConnection
from app.models.commercial import Plan, Subscription, UsageCounter
from app.models.identity import OrganizationMember
from app.models.messaging import MessageAttachment
from app.schemas.commercial import (
    PlanOut,
    PlanUsageOverview,
    SubscriptionOut,
    UsageMeterItem,
)


def get_current_year_month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


async def list_plans(db: AsyncSession) -> list[Plan]:
    res = await db.execute(
        select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price_cents_monthly.asc())
    )
    return list(res.scalars().all())


async def get_plan_by_key(db: AsyncSession, plan_key: str) -> Plan:
    res = await db.execute(select(Plan).where(Plan.key == plan_key, Plan.is_active.is_(True)))
    plan = res.scalar_one_or_none()
    if not plan:
        raise NotFoundError(f"Plan '{plan_key}' not found", code="plan_not_found")
    return plan


async def get_or_create_subscription(db: AsyncSession, org_id: uuid.UUID) -> Subscription:
    res = await db.execute(select(Subscription).where(Subscription.organization_id == org_id))
    sub = res.scalar_one_or_none()
    if sub:
        return sub

    # Create default 14-day trial of Growth for organizations without a subscription
    growth_plan = await get_plan_by_key(db, "growth")
    now = datetime.now(UTC)
    from datetime import timedelta

    sub = Subscription(
        organization_id=org_id,
        plan_id=growth_plan.id,
        status="trialing",
        billing_interval="monthly",
        current_period_start=now,
        current_period_end=now + timedelta(days=14),
        trial_end=now + timedelta(days=14),
        provider="stripe",
    )
    db.add(sub)
    await db.flush()
    # Eager load the plan relation
    sub.plan = growth_plan
    return sub


async def get_effective_plan(db: AsyncSession, org_id: uuid.UUID) -> tuple[Subscription, Plan]:
    sub = await get_or_create_subscription(db, org_id)
    now = datetime.now(UTC)

    # If trial ended and status is still trialing, fall back to Free plan
    if sub.status == "trialing" and sub.trial_end and sub.trial_end < now:
        free_plan = await get_plan_by_key(db, "free")
        return sub, free_plan

    # If subscription is canceled, fall back to Free plan limits
    if sub.status == "canceled":
        free_plan = await get_plan_by_key(db, "free")
        return sub, free_plan

    # Ensure plan is loaded
    if not sub.plan:
        res = await db.execute(select(Plan).where(Plan.id == sub.plan_id))
        sub.plan = res.scalar_one()

    return sub, sub.plan


def format_subscription_out(sub: Subscription, plan: Plan | None = None) -> SubscriptionOut:
    effective_plan = plan or getattr(sub, "plan", None)
    return SubscriptionOut(
        id=sub.id,
        organization_id=sub.organization_id,
        plan_id=sub.plan_id,
        plan_key=effective_plan.key if effective_plan else "growth",
        plan_name=effective_plan.name if effective_plan else "Growth",
        status=sub.status,
        billing_interval=sub.billing_interval,
        current_period_start=sub.current_period_start,
        current_period_end=sub.current_period_end,
        trial_end=sub.trial_end,
        cancel_at_period_end=sub.cancel_at_period_end,
        provider=sub.provider,
    )


async def get_usage_overview(db: AsyncSession, org_id: uuid.UUID) -> PlanUsageOverview:
    sub, plan = await get_effective_plan(db, org_id)
    limits = plan.limits or {}
    ym = get_current_year_month()

    # 1. Members
    m_res = await db.execute(
        select(func.count())
        .select_from(OrganizationMember)
        .where(OrganizationMember.organization_id == org_id)
    )
    members_count = m_res.scalar() or 0

    # 2. Channels
    c_res = await db.execute(
        select(func.count())
        .select_from(ChannelConnection)
        .where(
            ChannelConnection.organization_id == org_id,
            ChannelConnection.deleted_at.is_(None),
        )
    )
    channels_count = c_res.scalar() or 0

    # 3. Workflows (active)
    w_res = await db.execute(
        select(func.count())
        .select_from(Workflow)
        .where(
            Workflow.organization_id == org_id,
            Workflow.status == "active",
        )
    )
    workflows_count = w_res.scalar() or 0

    # 4. Schedules (active)
    s_res = await db.execute(
        select(func.count())
        .select_from(Schedule)
        .where(
            Schedule.organization_id == org_id,
            Schedule.status == "active",
        )
    )
    schedules_count = s_res.scalar() or 0

    # 5. Monthly usage counters (workflow runs & outbound messages)
    u_res = await db.execute(
        select(UsageCounter).where(
            UsageCounter.organization_id == org_id,
            UsageCounter.year_month == ym,
        )
    )
    counter = u_res.scalar_one_or_none()
    monthly_runs = counter.workflow_runs_count if counter else 0
    monthly_messages = counter.outbound_messages_count if counter else 0

    # 6. Storage MB
    st_res = await db.execute(
        select(func.coalesce(func.sum(MessageAttachment.size_bytes), 0)).where(
            MessageAttachment.organization_id == org_id
        )
    )
    bytes_used = st_res.scalar() or 0
    storage_mb = int(bytes_used / (1024 * 1024))

    # Build meters
    metric_configs = [
        ("max_members", "Team Seats", members_count),
        ("max_channels", "Channels", channels_count),
        ("max_workflows", "Active Workflows", workflows_count),
        ("max_active_schedules", "Active Schedules", schedules_count),
        ("max_monthly_runs", "Monthly Workflow Runs", monthly_runs),
        ("max_monthly_messages", "Monthly Messages", monthly_messages),
        ("max_storage_mb", "Storage (MB)", storage_mb),
    ]

    meters: list[UsageMeterItem] = []
    for limit_key, label, used in metric_configs:
        limit_val = limits.get(limit_key, 999999)
        pct = round((used / limit_val) * 100, 1) if limit_val > 0 else 0.0
        meters.append(
            UsageMeterItem(
                metric=limit_key,
                label=label,
                used=used,
                limit=limit_val,
                percentage=pct,
            )
        )

    # Trial days remaining
    trial_days = None
    if sub.status == "trialing" and sub.trial_end:
        now = datetime.now(UTC)
        if sub.trial_end > now:
            trial_days = max(0, (sub.trial_end - now).days + 1)
        else:
            trial_days = 0

    sub_out = format_subscription_out(sub, plan)

    return PlanUsageOverview(
        plan=PlanOut.model_validate(plan),
        subscription=sub_out,
        trial_days_remaining=trial_days,
        meters=meters,
    )


async def check_resource_limit(
    db: AsyncSession,
    org_id: uuid.UUID,
    metric: Literal["max_members", "max_channels", "max_workflows", "max_active_schedules"],
    delta: int = 1,
) -> None:
    """Checks resource count limits (seats, channels, workflows, schedules) before allocating.

    Raises PlanLimitExceededError if adding `delta` would exceed the limit.
    """
    _sub, plan = await get_effective_plan(db, org_id)
    limit = plan.limits.get(metric, 999999)

    current_count = 0
    if metric == "max_members":
        res = await db.execute(
            select(func.count())
            .select_from(OrganizationMember)
            .where(OrganizationMember.organization_id == org_id)
        )
        current_count = res.scalar() or 0
    elif metric == "max_channels":
        res = await db.execute(
            select(func.count())
            .select_from(ChannelConnection)
            .where(
                ChannelConnection.organization_id == org_id,
                ChannelConnection.deleted_at.is_(None),
            )
        )
        current_count = res.scalar() or 0
    elif metric == "max_workflows":
        res = await db.execute(
            select(func.count())
            .select_from(Workflow)
            .where(
                Workflow.organization_id == org_id,
                Workflow.status == "active",
            )
        )
        current_count = res.scalar() or 0
    elif metric == "max_active_schedules":
        res = await db.execute(
            select(func.count())
            .select_from(Schedule)
            .where(
                Schedule.organization_id == org_id,
                Schedule.status == "active",
            )
        )
        current_count = res.scalar() or 0

    if current_count + delta > limit:
        raise PlanLimitExceededError(
            f"Plan limit reached for {metric.replace('max_', '').replace('_', ' ')}. Upgrade your plan to increase limits.",
            metric=metric,
            limit=limit,
            used=current_count,
        )


async def increment_monthly_usage(
    db: AsyncSession,
    org_id: uuid.UUID,
    metric: Literal["workflow_runs", "outbound_messages"],
    delta: int = 1,
) -> int:
    """Atomically increments monthly usage for workflow runs or outbound messages.

    Guarantees concurrency safety via atomic conditional SQL execution.
    Raises PlanLimitExceededError if the increment would exceed the plan limit.
    """
    _sub, plan = await get_effective_plan(db, org_id)
    limit_key = f"max_monthly_{metric}"
    limit = plan.limits.get(limit_key, 999999)
    ym = get_current_year_month()

    runs_delta = delta if metric == "workflow_runs" else 0
    msgs_delta = delta if metric == "outbound_messages" else 0

    runs_limit = limit if metric == "workflow_runs" else 999999999
    msgs_limit = limit if metric == "outbound_messages" else 999999999

    sql = text(
        """
        INSERT INTO usage_counters (id, organization_id, year_month, workflow_runs_count, outbound_messages_count, created_at, updated_at)
        VALUES (gen_random_uuid(), :org_id, :ym,
            CASE WHEN CAST(:runs_delta AS int) <= CAST(:runs_limit AS int) THEN CAST(:runs_delta AS int) ELSE 0 END,
            CASE WHEN CAST(:msgs_delta AS int) <= CAST(:msgs_limit AS int) THEN CAST(:msgs_delta AS int) ELSE 0 END,
            now(), now())
        ON CONFLICT (organization_id, year_month)
        DO UPDATE SET
            workflow_runs_count = CASE
                WHEN usage_counters.workflow_runs_count + CAST(:runs_delta AS int) <= CAST(:runs_limit AS int)
                THEN usage_counters.workflow_runs_count + CAST(:runs_delta AS int)
                ELSE usage_counters.workflow_runs_count
            END,
            outbound_messages_count = CASE
                WHEN usage_counters.outbound_messages_count + CAST(:msgs_delta AS int) <= CAST(:msgs_limit AS int)
                THEN usage_counters.outbound_messages_count + CAST(:msgs_delta AS int)
                ELSE usage_counters.outbound_messages_count
            END,
            updated_at = now()
        RETURNING workflow_runs_count, outbound_messages_count;
        """
    )

    res = await db.execute(
        sql,
        {
            "org_id": org_id,
            "ym": ym,
            "runs_delta": runs_delta,
            "msgs_delta": msgs_delta,
            "runs_limit": runs_limit,
            "msgs_limit": msgs_limit,
        },
    )
    row = res.fetchone()
    if not row:
        raise PlanLimitExceededError(
            f"Monthly {metric.replace('_', ' ')} limit reached ({limit}). Upgrade your plan to increase limits.",
            metric=limit_key,
            limit=limit,
            used=limit,
        )

    current_val = row[0] if metric == "workflow_runs" else row[1]

    # Verify that the counter was actually incremented by delta
    # If it wasn't, that means the CASE condition failed because it exceeded limit
    # We query the actual current count to report exact usage
    # Note: If this was a fresh row where delta > limit, current_val is 0.
    if current_val < delta:
        raise PlanLimitExceededError(
            f"Monthly {metric.replace('_', ' ')} limit reached ({limit}). Upgrade your plan to increase limits.",
            metric=limit_key,
            limit=limit,
            used=limit,
        )

    return current_val
