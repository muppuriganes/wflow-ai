"""Database sessions with Row Level Security context.

The runtime role (`wflow_app`) is not the table owner, so PostgreSQL enforces the RLS
policies created in the migrations. Policies read two transaction-local settings:

    app.current_user_id   – the authenticated user
    app.current_org_id    – the organization the request acts on

The values live in `session.info["rls"]` and are re-applied by an `after_begin` hook at
the start of every transaction (set_config(..., is_local => true) is cleared on commit),
so a commit mid-request never silently drops the tenant context. With no context set the
policies match nothing, i.e. the database fails closed.
"""

import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, SessionTransaction

from app.core.config import get_settings

_SET_CONTEXT = text(
    "SELECT set_config('app.current_user_id', :user_id, true), "
    "set_config('app.current_org_id', :org_id, true)"
)


@dataclass
class RLSContext:
    user_id: uuid.UUID | None = None
    org_id: uuid.UUID | None = None

    def params(self) -> dict[str, str]:
        return {
            "user_id": str(self.user_id) if self.user_id else "",
            "org_id": str(self.org_id) if self.org_id else "",
        }


class TenantSession(Session):
    """Sync session class behind AsyncSession; carries the RLS context."""


@event.listens_for(TenantSession, "after_begin")
def _apply_rls_context(session: Session, _tx: SessionTransaction, connection: Any) -> None:
    ctx: RLSContext = session.info.setdefault("rls", RLSContext())
    connection.execute(_SET_CONTEXT, ctx.params())


_UNSET: Any = object()


async def set_rls_context(
    session: AsyncSession, *, user_id: uuid.UUID | None = _UNSET, org_id: uuid.UUID | None = _UNSET
) -> None:
    """Update the RLS context; applies immediately if a transaction is already open."""
    ctx: RLSContext = session.info.setdefault("rls", RLSContext())
    if user_id is not _UNSET:
        ctx.user_id = user_id
    if org_id is not _UNSET:
        ctx.org_id = org_id
    if session.in_transaction():
        await session.execute(_SET_CONTEXT, ctx.params())


def get_rls_context(session: AsyncSession) -> RLSContext:
    ctx: RLSContext = session.info.setdefault("rls", RLSContext())
    return ctx


def build_engine(url: str) -> AsyncEngine:
    return create_async_engine(url, pool_pre_ping=True, pool_size=10, max_overflow=20)


engine: AsyncEngine = build_engine(get_settings().database_url)
SessionFactory = async_sessionmaker(engine, expire_on_commit=False, sync_session_class=TenantSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    """One session per request. Services commit explicitly; anything uncommitted is rolled back."""
    async with SessionFactory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
