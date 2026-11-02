"""Operational commands.  Usage:  uv run python -m app.cli <command>

sync-rbac                 upsert permissions and built-in roles from app/core/rbac.py
create-superadmin EMAIL   grant platform Super Admin to an existing user
"""

import asyncio
import sys

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import get_settings
from app.core.rbac import PERMISSIONS, SYSTEM_ROLES
from app.models import Permission, Role, RolePermission, User


async def sync_rbac(engine: AsyncEngine) -> None:
    """Idempotent. Runs as the schema owner because the runtime role cannot write these tables."""
    async with engine.begin() as conn:
        for perm in PERMISSIONS:
            stmt = insert(Permission).values(
                code=perm.code, category=perm.category, description=perm.description
            )
            await conn.execute(
                stmt.on_conflict_do_update(
                    index_elements=[Permission.code],
                    set_={"category": stmt.excluded.category, "description": stmt.excluded.description},
                )
            )
        perm_ids = {code: pid for code, pid in await conn.execute(select(Permission.code, Permission.id))}

        for role in SYSTEM_ROLES:
            role_id = await conn.scalar(
                select(Role.id).where(Role.organization_id.is_(None), Role.key == role.key)
            )
            values = {
                "name": role.name,
                "description": role.description,
                "rank": role.rank,
                "is_system": True,
            }
            if role_id is None:
                role_id = await conn.scalar(
                    insert(Role).values(key=role.key, organization_id=None, **values).returning(Role.id)
                )
            else:
                await conn.execute(update(Role).where(Role.id == role_id).values(**values))
            await conn.execute(delete(RolePermission).where(RolePermission.role_id == role_id))
            await conn.execute(
                insert(RolePermission),
                [{"role_id": role_id, "permission_id": perm_ids[code]} for code in sorted(role.permissions)],
            )


async def create_superadmin(engine: AsyncEngine, email: str) -> None:
    async with engine.begin() as conn:
        result = await conn.execute(
            update(User).where(User.email == email.strip().lower()).values(is_superadmin=True)
        )
        if result.rowcount == 0:  # type: ignore[attr-defined]
            raise SystemExit(f"No user with email {email}")


async def _main(argv: list[str]) -> None:
    engine = create_async_engine(get_settings().database_admin_url)
    try:
        match argv:
            case ["sync-rbac"]:
                await sync_rbac(engine)
                print("RBAC synchronised")
            case ["create-superadmin", email]:
                await create_superadmin(engine, email)
                print(f"{email} is now a Super Admin")
            case _:
                print(__doc__)
                raise SystemExit(2)
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(_main(sys.argv[1:]))
