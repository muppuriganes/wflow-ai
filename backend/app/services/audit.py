import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.request_context import get_request_meta
from app.models import AuditLog


def record_audit(
    db: AsyncSession,
    action: str,
    *,
    organization_id: uuid.UUID | None = None,
    actor_user_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    """Adds an audit entry to the current unit of work; it commits with the change it describes."""
    meta = get_request_meta()
    db.add(
        AuditLog(
            organization_id=organization_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id else None,
            details=details or {},
            ip_address=meta.ip_address,
            user_agent=(meta.user_agent or "")[:500] or None,
            request_id=meta.request_id,
            # Set client-side so the INSERT needs no RETURNING: anonymous rows (e.g. a failed login
            # for an unknown email) are insertable but, by design, not readable back under RLS.
            created_at=datetime.now(UTC),
        )
    )
