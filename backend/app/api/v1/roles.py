from fastapi import APIRouter
from sqlalchemy import select

from app.api.deps import DB, CurrentUser, OrgCtx
from app.models import Permission, Role
from app.schemas.organization import PermissionOut, RoleOut

router = APIRouter(tags=["roles"])


@router.get("/organizations/{org_id}/roles")
async def list_roles(db: DB, ctx: OrgCtx) -> list[RoleOut]:
    """System roles plus this organization's custom roles (RLS scopes the latter)."""
    ctx.require("roles.read")
    roles = await db.scalars(select(Role).order_by(Role.rank.desc(), Role.name))
    return [
        RoleOut(
            id=r.id,
            key=r.key,
            name=r.name,
            description=r.description,
            rank=r.rank,
            is_system=r.is_system,
            permissions=sorted(p.code for p in r.permissions),
        )
        for r in roles
    ]


@router.get("/permissions")
async def list_permissions(db: DB, _: CurrentUser) -> list[PermissionOut]:
    rows = await db.scalars(select(Permission).order_by(Permission.category, Permission.code))
    return [PermissionOut.model_validate(p) for p in rows]
