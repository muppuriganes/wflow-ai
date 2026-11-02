import asyncio
from datetime import UTC, datetime

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
    a = await register(client, "owner-plans-change@example.com")
    res = await client.post(
        f"/api/v1/organizations/{a.org_id}/plans/change",
        headers=a.headers,
        json={"plan_key": "business", "billing_interval": "yearly"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["plan"]["key"] == "business"
    assert data["subscription"]["billing_interval"] == "yearly"
    assert data["plan"]["limits"]["max_members"] == 50
