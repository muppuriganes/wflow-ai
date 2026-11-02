"""Super Admin console endpoints for cross-tenant management and platform monitoring."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.api.deps import DB, require_superadmin
from app.models import User
from app.schemas.commercial import (
    AdminAssignPlanIn,
    AdminHealthOut,
    AdminOrgDetailOut,
    AdminOrgListItem,
    AdminOrgListOut,
    AdminSuspendOrgIn,
    SubscriptionOut,
)
from app.services import admin as admin_svc

router = APIRouter(prefix="/admin", tags=["admin"])

SuperAdmin = Annotated[User, Depends(require_superadmin)]


@router.get("/organizations", response_model=AdminOrgListOut)
async def list_admin_organizations(
    _: SuperAdmin,
    db: DB,
    search: str | None = Query(default=None),
    plan_key: str | None = Query(default=None),
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
) -> AdminOrgListOut:
    items, total = await admin_svc.list_organizations(
        db, search=search, plan_key=plan_key, status=status, page=page, page_size=page_size
    )
    return AdminOrgListOut(
        items=[AdminOrgListItem(**x) for x in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/organizations/{org_id}", response_model=AdminOrgDetailOut)
async def get_admin_organization_detail(
    org_id: uuid.UUID,
    _: SuperAdmin,
    db: DB,
) -> AdminOrgDetailOut:
    detail = await admin_svc.get_organization_detail(db, org_id)
    return AdminOrgDetailOut(**detail)


@router.post("/organizations/{org_id}/plan", response_model=SubscriptionOut)
async def assign_organization_plan(
    org_id: uuid.UUID,
    data: AdminAssignPlanIn,
    admin_user: SuperAdmin,
    db: DB,
) -> SubscriptionOut:
    sub = await admin_svc.assign_plan(db, admin_user, org_id, data)
    await db.commit()
    return sub


@router.post("/organizations/{org_id}/suspend")
async def suspend_organization(
    org_id: uuid.UUID,
    data: AdminSuspendOrgIn,
    admin_user: SuperAdmin,
    db: DB,
) -> dict[str, Any]:
    org = await admin_svc.suspend_organization(db, admin_user, org_id, data.reason)
    await db.commit()
    return {
        "status": "ok",
        "organization_id": str(org.id),
        "org_status": org.status,
        "suspended_at": org.suspended_at.isoformat() if org.suspended_at else None,
        "suspended_reason": org.suspended_reason,
    }


@router.post("/organizations/{org_id}/restore")
async def restore_organization(
    org_id: uuid.UUID,
    admin_user: SuperAdmin,
    db: DB,
) -> dict[str, Any]:
    org = await admin_svc.restore_organization(db, admin_user, org_id)
    await db.commit()
    return {
        "status": "ok",
        "organization_id": str(org.id),
        "org_status": org.status,
    }


@router.get("/health", response_model=AdminHealthOut)
async def get_system_health(
    _: SuperAdmin,
    db: DB,
) -> AdminHealthOut:
    res = await admin_svc.check_system_health(db)
    return AdminHealthOut(**res)
