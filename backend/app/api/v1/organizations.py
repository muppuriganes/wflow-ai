import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, OrgCtx, require_permission
from app.database.session import set_rls_context
from app.models import AuditLog, Invitation, OrganizationMember, Role, User
from app.schemas.common import Page
from app.schemas.organization import (
    AuditLogOut,
    InvitationCreate,
    InvitationOut,
    MemberOut,
    MemberUpdate,
    MyOrganizationOut,
    OrganizationCreate,
    OrganizationOut,
    OrganizationUpdate,
    RoleSummary,
)
from app.services import organizations as org_service
from app.services.organizations import OrgContext

router = APIRouter(prefix="/organizations", tags=["organizations"])


def _my_org(org: object, role: Role) -> MyOrganizationOut:
    base = OrganizationOut.model_validate(org).model_dump()
    return MyOrganizationOut(
        **base, role=RoleSummary.model_validate(role), permissions=sorted(p.code for p in role.permissions)
    )


def _member_out(m: OrganizationMember) -> MemberOut:
    return MemberOut(
        id=m.id,
        user_id=m.user_id,
        email=m.user.email,
        full_name=m.user.full_name,
        role=RoleSummary.model_validate(m.role),
        status=m.status,
        joined_at=m.created_at,
    )


def _invitation_out(inv: Invitation) -> InvitationOut:
    return InvitationOut(
        id=inv.id,
        email=inv.email,
        role=RoleSummary.model_validate(inv.role),
        status=org_service.invitation_status(inv),  # type: ignore[arg-type]
        expires_at=inv.expires_at,
        created_at=inv.created_at,
    )


@router.get("")
async def list_my_organizations(db: DB, user: CurrentUser) -> list[MyOrganizationOut]:
    return [_my_org(org, m.role) for m, org in await org_service.list_user_memberships(db, user.id)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_organization(data: OrganizationCreate, db: DB, user: CurrentUser) -> MyOrganizationOut:
    org = await org_service.create_organization(db, user, data)
    await db.commit()
    ctx = await org_service.resolve_org_context(db, user, org.id)
    return _my_org(ctx.organization, ctx.membership.role)


@router.get("/{org_id}")
async def get_organization(ctx: OrgCtx) -> MyOrganizationOut:
    return _my_org(ctx.organization, ctx.membership.role)


@router.patch("/{org_id}")
async def update_organization(data: OrganizationUpdate, db: DB, ctx: OrgCtx) -> MyOrganizationOut:
    org = await org_service.update_organization(db, ctx, data)
    return _my_org(org, ctx.membership.role)


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(db: DB, ctx: OrgCtx) -> None:
    await org_service.delete_organization(db, ctx)


# --- Members -------------------------------------------------------------------------


@router.get("/{org_id}/members")
async def list_members(db: DB, ctx: OrgCtx) -> list[MemberOut]:
    return [_member_out(m) for m in await org_service.list_members(db, ctx)]


@router.patch("/{org_id}/members/{member_id}")
async def update_member(member_id: uuid.UUID, data: MemberUpdate, db: DB, ctx: OrgCtx) -> MemberOut:
    return _member_out(await org_service.update_member_role(db, ctx, member_id, data.role_key))


@router.delete("/{org_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(member_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    """Also used to leave an organization (pass your own member id)."""
    await org_service.remove_member(db, ctx, member_id)


# --- Invitations ---------------------------------------------------------------------


@router.get("/{org_id}/invitations")
async def list_invitations(db: DB, ctx: OrgCtx) -> list[InvitationOut]:
    return [_invitation_out(i) for i in await org_service.list_invitations(db, ctx)]


@router.post("/{org_id}/invitations", status_code=status.HTTP_201_CREATED)
async def create_invitation(data: InvitationCreate, db: DB, ctx: OrgCtx) -> InvitationOut:
    return _invitation_out(await org_service.create_invitation(db, ctx, data.email, data.role_key))


@router.delete("/{org_id}/invitations/{invitation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_invitation(invitation_id: uuid.UUID, db: DB, ctx: OrgCtx) -> None:
    await org_service.revoke_invitation(db, ctx, invitation_id)


# --- Audit log -----------------------------------------------------------------------


@router.get("/{org_id}/audit-logs")
async def list_audit_logs(
    db: DB,
    ctx: Annotated[OrgContext, Depends(require_permission("audit.read"))],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    action: Annotated[str | None, Query(max_length=100)] = None,
) -> Page[AuditLogOut]:
    await set_rls_context(db, org_id=ctx.org_id)
    where = [AuditLog.organization_id == ctx.org_id]
    if action:
        where.append(AuditLog.action.startswith(action))
    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*where)) or 0
    rows = await db.execute(
        select(AuditLog, User.email)
        .outerjoin(User, User.id == AuditLog.actor_user_id)
        .where(*where)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    items = [AuditLogOut.model_validate(log).model_copy(update={"actor_email": email}) for log, email in rows]
    return Page(items=items, total=total, page=page, page_size=page_size)
