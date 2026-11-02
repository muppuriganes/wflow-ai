from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser
from app.database.session import set_rls_context
from app.models import AuditLog
from app.schemas.auth import UpdateProfileRequest, UserOut
from app.schemas.common import Page
from app.schemas.organization import AuditLogOut
from app.services.audit import record_audit

router = APIRouter(prefix="/me", tags=["me"])


@router.get("")
async def get_me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.patch("")
async def update_me(data: UpdateProfileRequest, db: DB, user: CurrentUser) -> UserOut:
    user.full_name = data.full_name
    record_audit(db, "user.profile_updated", actor_user_id=user.id)
    await db.commit()
    return UserOut.model_validate(user)


@router.get("/activity")
async def my_activity(
    db: DB,
    user: CurrentUser,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page[AuditLogOut]:
    """Account-level security events (sign-ins, password changes)."""
    await set_rls_context(db, org_id=None)
    where = (AuditLog.organization_id.is_(None), AuditLog.actor_user_id == user.id)
    total = await db.scalar(select(func.count()).select_from(AuditLog).where(*where)) or 0
    rows = await db.scalars(
        select(AuditLog)
        .where(*where)
        .order_by(AuditLog.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return Page(
        items=[AuditLogOut.model_validate(r) for r in rows], total=total, page=page, page_size=page_size
    )
