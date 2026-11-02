import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import Depends, Path, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthenticationError, PermissionDeniedError
from app.core.rate_limit import enforce_rate_limit
from app.core.security import decode_access_token
from app.database.session import get_db, set_rls_context
from app.models import User
from app.services.organizations import OrgContext, enforce_access, resolve_org_context

DB = Annotated[AsyncSession, Depends(get_db)]

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    db: DB, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)]
) -> User:
    if credentials is None:
        raise AuthenticationError("Authentication required")
    user_id = decode_access_token(credentials.credentials)
    await set_rls_context(db, user_id=user_id, org_id=None)
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Account is not active")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


async def get_org_context(
    request: Request, db: DB, user: CurrentUser, org_id: Annotated[uuid.UUID, Path()]
) -> OrgContext:
    ctx = await resolve_org_context(db, user, org_id)
    prefix = f"/api/v1/organizations/{org_id}"
    path = request.url.path
    enforce_access(ctx, request.method, path[len(prefix) :] if path.startswith(prefix) else path)
    return ctx


OrgCtx = Annotated[OrgContext, Depends(get_org_context)]


def require_permission(permission: str) -> Callable[[OrgContext], Awaitable[OrgContext]]:
    """Route-level permission gate. Services re-check, so a missing route guard still fails closed."""

    async def _check(ctx: OrgCtx) -> OrgContext:
        ctx.require(permission)
        return ctx

    return _check


async def require_superadmin(user: CurrentUser) -> User:
    if not user.is_superadmin:
        raise PermissionDeniedError("Super Admin access required")
    return user


def auth_rate_limit(bucket: str) -> Callable[[Request], Awaitable[None]]:
    async def _limit(request: Request) -> None:
        settings = get_settings()
        client = request.client.host if request.client else "unknown"
        await enforce_rate_limit(
            bucket, client, limit=settings.auth_rate_limit, window_seconds=settings.auth_rate_window_seconds
        )

    return _limit
