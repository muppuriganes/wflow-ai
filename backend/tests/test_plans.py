import asyncio
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.errors import PlanLimitExceededError
from app.database.session import SessionFactory, set_rls_context
from app.services import plans
from tests.conftest import register


@pytest.mark.asyncio
async def test_list_plans(client: AsyncClient) -> None:
    a = await register(client, "owner-plans-list@example.com")
    res = await client.get(f"/api/v1/organizations/{a.org_id}/plans", headers=a.headers)
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    keys = [p["key"] for p in data]
    assert "free" in keys
    assert "starter" in keys
    assert "growth" in keys
    assert "business" in keys


@pytest.mark.asyncio
async def test_plan_usage_overview(client: AsyncClient) -> None:
    a = await register(client, "owner-plans-usage@example.com")
    res = await client.get(f"/api/v1/organizations/{a.org_id}/plans/usage", headers=a.headers)
    assert res.status_code == 200
    data = res.json()
    assert data["subscription"]["plan_key"] in ("growth", "free", "starter", "business")
    assert "meters" in data
    metrics = {m["metric"]: m for m in data["meters"]}
    assert "max_members" in metrics
    assert "max_channels" in metrics
    assert "max_workflows" in metrics
    assert "max_active_schedules" in metrics
    assert "max_monthly_runs" in metrics
    assert "max_monthly_messages" in metrics


@pytest.mark.asyncio
async def test_plan_tenant_cannot_modify_plans(client: AsyncClient) -> None:
    """Verifies that RLS prevents tenants from modifying or deleting global plans."""
    a = await register(client, "owner-plans-immut@example.com")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=a.org_id)
        # Tenant can read plans
        res = await db.execute(text("SELECT count(*) FROM plans"))
        assert (res.scalar() or 0) >= 4

        # Tenant cannot delete plans (RLS policy using(false) filters all rows out from write)
        del_res = await db.execute(text("DELETE FROM plans WHERE key = 'free'"))
        assert del_res.rowcount == 0
        await db.commit()

        # Tenant cannot update plans
        upd_res = await db.execute(text("UPDATE plans SET name = 'Hacked' WHERE key = 'free'"))
        assert upd_res.rowcount == 0
        await db.commit()

        # Verify free plan is still intact
        check_res = await db.execute(text("SELECT name FROM plans WHERE key = 'free'"))
        assert check_res.scalar() == "Free"


@pytest.mark.asyncio
async def test_enforce_resource_limits(client: AsyncClient) -> None:
    """Verifies that check_resource_limit raises PlanLimitExceededError when limits are reached."""
    a = await register(client, "owner-plans-limits@example.com")
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=a.org_id)
        # Check an impossibly high delta
        with pytest.raises(PlanLimitExceededError) as exc_info:
            await plans.check_resource_limit(db, a.org_id, "max_channels", delta=100)

        err = exc_info.value
        assert err.code == "plan_limit_reached"
        assert err.details["metric"] == "max_channels"
        assert "limit" in err.details


@pytest.mark.asyncio
async def test_atomic_concurrent_usage_counting(client: AsyncClient) -> None:
    """Hammers the atomic usage counter concurrently to prove no race conditions or overages."""
    a = await register(client, "owner-plans-concurrent@example.com")

    # Run 10 increments concurrently
    async def worker(n: int) -> bool:
        async with SessionFactory() as db:
            await set_rls_context(db, user_id=None, org_id=a.org_id)
            try:
                await plans.increment_monthly_usage(db, a.org_id, "workflow_runs", delta=1)
                await db.commit()
                return True
            except PlanLimitExceededError:
                await db.rollback()
                return False

    results = await asyncio.gather(*(worker(i) for i in range(10)))
    successes = sum(1 for r in results if r)
    assert successes == 10

    # Verify the count in the database is exactly 10
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=a.org_id)
        ym = datetime.now(UTC).strftime("%Y-%m")
        res = await db.execute(
            text(
                "SELECT workflow_runs_count FROM usage_counters WHERE organization_id = :org_id AND year_month = :ym"
            ),
            {"org_id": a.org_id, "ym": ym},
        )
        count = res.scalar()
        assert count == 10


@pytest.mark.asyncio
async def test_change_plan(client: AsyncClient) -> None:
    """Self-service changes only reach free plans; paid plans need a completed checkout."""
    a = await register(client, "owner-plans-change@example.com")
    url = f"/api/v1/organizations/{a.org_id}/plans/change"
    paid = await client.post(
        url, headers=a.headers, json={"plan_key": "business", "billing_interval": "yearly"}
    )
    assert paid.status_code == 402  # used to upgrade for free
    usage = (await client.get(f"/api/v1/organizations/{a.org_id}/plans/usage", headers=a.headers)).json()
    assert usage["plan"]["key"] == "growth"  # still the trial plan
    free = await client.post(url, headers=a.headers, json={"plan_key": "free"})
    assert free.status_code == 200 and free.json()["plan"]["key"] == "free"


async def test_monthly_limits_are_enforced(client: AsyncClient, admin_engine: Any) -> None:
    """Once a month's quota is used up, every further run or message is refused."""
    import uuid

    from sqlalchemy import update

    from app.core.errors import PlanLimitExceededError
    from app.database.session import SessionFactory, set_rls_context
    from app.models import Plan
    from app.services import plans

    a = await register(client, "limit-monthly@example.com")
    org = uuid.UUID(a.org_id)
    async with admin_engine.begin() as conn:  # a tiny limit on the trial plan, restored below
        await conn.execute(update(Plan).where(Plan.key == "growth").values(
            limits=Plan.limits.op("||")({"max_monthly_messages": 2})))  # fmt: skip
    try:
        async with SessionFactory() as db:
            await set_rls_context(db, user_id=None, org_id=org)
            assert [await plans.increment_monthly_usage(db, org, "outbound_messages") for _ in range(2)] == [
                1,
                2,
            ]
            for _ in range(3):
                with pytest.raises(PlanLimitExceededError) as exc:
                    await plans.increment_monthly_usage(db, org, "outbound_messages")
                assert exc.value.details == {"metric": "max_monthly_messages", "limit": 2, "used": 2}
            assert await plans.increment_monthly_usage(db, org, "workflow_runs") == 1  # separate counter
            await db.commit()
    finally:
        async with admin_engine.begin() as conn:
            await conn.execute(update(Plan).where(Plan.key == "growth").values(
                limits=Plan.limits.op("||")({"max_monthly_messages": 25000})))  # fmt: skip
