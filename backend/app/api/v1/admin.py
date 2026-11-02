"""Super Admin console endpoints for cross-tenant management and platform monitoring."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from app.api.deps import DB, require_superadmin
from app.core.errors import NotFoundError
from app.models import User
from app.schemas.commercial import (
    AdminAssignPlanIn,
    AdminHealthOut,
    AdminOrgDetailOut,
    AdminOrgListItem,
    AdminOrgListOut,
    AdminSuspendOrgIn,
    InvoiceOut,
    PlanOut,
    SubscriptionOut,
)
from app.schemas.organization import OrgName, Timezone
from app.services import admin as admin_svc
from app.services import platform_admin as platform
from app.services.audit import record_audit

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


# --- Platform governance: requests, billing switch, organization tabs, users, analytics -----


class ApproveIn(BaseModel):
    billing_required: bool
    plan_key: str = Field(default="growth", min_length=1, max_length=50)
    trial_days: int | None = Field(default=None, ge=1, le=365)


class RejectIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class BillingIn(BaseModel):
    billing_required: bool
    plan_key: str | None = Field(default=None, min_length=1, max_length=50)
    trial_days: int | None = Field(default=None, ge=1, le=365)


class OrgSettingsIn(BaseModel):
    name: OrgName | None = None
    timezone: Timezone | None = None


class FlagIn(BaseModel):
    value: bool


@router.get("/stats")
async def platform_stats(
    admin: SuperAdmin, db: DB, days: Annotated[int, Query(ge=1, le=365)] = 30
) -> dict[str, Any]:
    """Platform-wide counts (no customer content)."""
    return await platform.platform_stats(db, days)


@router.get("/requests")
async def list_requests(
    admin: SuperAdmin, db: DB, status: Literal["pending", "rejected", "approved"] = "pending"
) -> list[dict[str, Any]]:
    return await platform.list_requests(db, status)


@router.post("/organizations/{org_id}/approve")
async def approve_organization(
    org_id: uuid.UUID, data: ApproveIn, admin: SuperAdmin, db: DB
) -> dict[str, Any]:
    org = await platform.approve(db, admin, org_id, billing_required=data.billing_required, plan_key=data.plan_key,
                                 trial_days=data.trial_days)  # fmt: skip
    return {"id": org.id, "approval_status": org.approval_status, "billing_required": org.billing_required}


@router.post("/organizations/{org_id}/reject")
async def reject_organization(org_id: uuid.UUID, data: RejectIn, admin: SuperAdmin, db: DB) -> dict[str, Any]:
    org = await platform.reject(db, admin, org_id, data.reason)
    return {"id": org.id, "approval_status": org.approval_status, "rejection_reason": org.rejection_reason}


@router.post("/organizations/{org_id}/billing")
async def set_organization_billing(
    org_id: uuid.UUID, data: BillingIn, admin: SuperAdmin, db: DB
) -> dict[str, Any]:
    org = await platform.set_billing(db, admin, org_id, billing_required=data.billing_required,
                                     plan_key=data.plan_key, trial_days=data.trial_days)  # fmt: skip
    return {"id": org.id, "billing_required": org.billing_required}


@router.patch("/organizations/{org_id}")
async def update_organization_settings(
    org_id: uuid.UUID, data: OrgSettingsIn, admin: SuperAdmin, db: DB
) -> dict[str, Any]:
    org = await platform.update_settings(db, admin, org_id, data.model_dump(exclude_none=True))
    return {"id": org.id, "name": org.name, "timezone": org.timezone}


@router.get("/organizations/{org_id}/channels")
async def organization_channels(org_id: uuid.UUID, admin: SuperAdmin, db: DB) -> list[dict[str, Any]]:
    return await platform.org_channels(db, admin, org_id)


@router.get("/organizations/{org_id}/members")
async def organization_members(org_id: uuid.UUID, admin: SuperAdmin, db: DB) -> list[dict[str, Any]]:
    return await platform.org_members(db, admin, org_id)


@router.get("/organizations/{org_id}/invoices", response_model=list[InvoiceOut])
async def organization_invoices(org_id: uuid.UUID, admin: SuperAdmin, db: DB) -> list[InvoiceOut]:
    return [InvoiceOut.model_validate(i) for i in await platform.org_invoices(db, admin, org_id)]


@router.get("/users")
async def list_users(
    admin: SuperAdmin, db: DB, q: str | None = Query(default=None, max_length=200),
    page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> dict[str, Any]:  # fmt: skip
    items, total = await platform.list_users(db, q, page, page_size)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/users/{user_id}")
async def user_detail(user_id: uuid.UUID, admin: SuperAdmin, db: DB) -> dict[str, Any]:
    return await platform.user_detail(db, user_id)


@router.post("/users/{user_id}/active")
async def set_user_active(user_id: uuid.UUID, data: FlagIn, admin: SuperAdmin, db: DB) -> dict[str, Any]:
    return await platform.set_user_active(db, admin, user_id, data.value)


@router.post("/users/{user_id}/sign-out")
async def sign_out_user(user_id: uuid.UUID, admin: SuperAdmin, db: DB) -> dict[str, int]:
    return {"sessions_revoked": await platform.sign_out_everywhere(db, admin, user_id)}


@router.post("/users/{user_id}/password-reset")
async def send_password_reset(user_id: uuid.UUID, admin: SuperAdmin, db: DB) -> dict[str, bool]:
    from app.services import auth as auth_service

    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    await auth_service.request_password_reset(db, user.email)
    record_audit(
        db, "admin.password_reset_sent", actor_user_id=admin.id, target_type="user", target_id=user_id
    )
    await db.commit()
    return {"sent": True}


@router.post("/users/{user_id}/superadmin")
async def set_user_superadmin(user_id: uuid.UUID, data: FlagIn, admin: SuperAdmin, db: DB) -> dict[str, Any]:
    return await platform.set_superadmin(db, admin, user_id, data.value)


@router.get("/plans", response_model=list[PlanOut])
async def list_plans(admin: SuperAdmin, db: DB) -> list[PlanOut]:
    from app.services.plans import list_plans as all_plans

    return [PlanOut.model_validate(p) for p in await all_plans(db)]
