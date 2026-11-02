"""Super Admin platform governance: organization requests, the per-organization billing switch,
user and login management, and counts-only platform analytics.

All functions run as the Super Admin (RLS super-admin policies apply); writes to one organization
switch the session to that organization first. Every change is audited. Message contents are never
read here: the console works with counts, settings and metadata only.
"""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, or_, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.email import OutgoingEmail, send_email_safely
from app.core.errors import AppError, ConflictError, NotFoundError
from app.core.logging import get_logger
from app.database.session import set_rls_context
from app.models import AuditLog, ChannelConnection, Organization, OrganizationMember, RefreshToken, User
from app.models.commercial import InvoiceRecord
from app.services.audit import record_audit
from app.services.plans import get_or_create_subscription, get_plan_by_key

log = get_logger("platform_admin")


async def _org(db: AsyncSession, admin: User, org_id: uuid.UUID) -> Organization:
    await set_rls_context(db, user_id=admin.id, org_id=org_id)
    org = await db.get(Organization, org_id)
    if org is None or org.deleted_at is not None:
        raise NotFoundError("Organization not found")
    return org


async def _owner(db: AsyncSession, org: Organization) -> User | None:
    return await db.get(User, org.created_by_user_id) if org.created_by_user_id else None


def _app_url(path: str) -> str:
    return get_settings().frontend_url.rstrip("/") + path


# --- Organization requests ----------------------------------------------------------------


async def notify_new_request(db: AsyncSession, requester: User, org: Organization) -> None:
    """Emails every Super Admin that an organization is waiting for review."""
    admins = (
        await db.scalars(select(User.email).where(User.is_superadmin.is_(True), User.is_active.is_(True)))
    ).all()
    details = org.request_details or {}
    lines = [f"{k.replace('_', ' ').title()}: {v}" for k, v in details.items()]
    for email in admins:
        await send_email_safely(OutgoingEmail(
            to=email, subject=f"New organization request: {org.name}",
            text=(f"{requester.full_name} <{requester.email}> asked to create “{org.name}”.\n\n"
                  + ("\n".join(lines) + "\n\n" if lines else "")
                  + f"Review it: {_app_url('/admin/requests')}\n"),
        ))  # fmt: skip


async def list_requests(db: AsyncSession, status: str = "pending") -> list[dict[str, Any]]:
    rows = await db.execute(
        select(Organization, User)
        .outerjoin(User, User.id == Organization.created_by_user_id)
        .where(Organization.deleted_at.is_(None), Organization.approval_status == status)
        .order_by(Organization.created_at.asc() if status == "pending" else Organization.reviewed_at.desc())
        .limit(200)
    )
    return [
        {
            "id": org.id,
            "name": org.name,
            "created_at": org.created_at,
            "approval_status": org.approval_status,
            "request_details": org.request_details or {},
            "rejection_reason": org.rejection_reason,
            "reviewed_at": org.reviewed_at,
            "requester": {
                "id": u.id,
                "full_name": u.full_name,
                "email": u.email,
                "email_verified": u.email_verified_at is not None,
            }
            if u
            else None,
        }  # fmt: skip
        for org, u in rows.all()
    ]


async def _apply_billing(db: AsyncSession, org: Organization, billing_required: bool, plan_key: str | None,
                         trial_days: int | None) -> None:  # fmt: skip
    """Billing off: the plan is granted, nothing to pay. Billing on: the organization pays through
    checkout; an optional trial gives it time to do so."""
    sub = await get_or_create_subscription(db, org.id)
    if plan_key:
        plan = await get_plan_by_key(db, plan_key)
        sub.plan_id, sub.plan = plan.id, plan
    now = datetime.now(UTC)
    org.billing_required = billing_required
    if not billing_required:
        sub.status, sub.trial_end, sub.cancel_at_period_end = "active", None, False
    elif sub.status == "active" and sub.provider_subscription_id:
        pass  # already paying: nothing changes
    elif trial_days:
        sub.status, sub.trial_end = "trialing", now + timedelta(days=trial_days)
    else:
        sub.status, sub.trial_end = "incomplete", None  # must check out before using the workspace


async def approve(db: AsyncSession, admin: User, org_id: uuid.UUID, *, billing_required: bool, plan_key: str,
                  trial_days: int | None) -> Organization:  # fmt: skip
    org = await _org(db, admin, org_id)
    if org.approval_status == "approved":
        raise ConflictError("This organization is already approved", code="already_approved")
    org.approval_status, org.reviewed_by_user_id, org.reviewed_at = "approved", admin.id, datetime.now(UTC)
    org.rejection_reason = None
    await _apply_billing(db, org, billing_required, plan_key, trial_days)
    record_audit(db, "admin.organization_approved", organization_id=org.id, actor_user_id=admin.id,
                 target_type="organization", target_id=org.id,
                 details={"billing_required": billing_required, "plan": plan_key, "trial_days": trial_days})  # fmt: skip
    await db.commit()
    owner = await _owner(db, org)
    if owner:
        pay = (
            "Choose a plan on the Billing page to start."
            if billing_required and not trial_days
            else f"Your {trial_days}-day trial has started."
            if billing_required
            else "Your workspace is ready."
        )
        await send_email_safely(OutgoingEmail(
            to=owner.email, subject=f"{org.name} is approved on WFlow AI",
            text=f"Good news — {org.name} has been approved. {pay}\n\nSign in: {_app_url('/')}\n",
        ))  # fmt: skip
    return org


async def reject(db: AsyncSession, admin: User, org_id: uuid.UUID, reason: str) -> Organization:
    org = await _org(db, admin, org_id)
    if org.approval_status == "approved":
        raise ConflictError(
            "Approved organizations can't be rejected; suspend them instead", code="already_approved"
        )
    org.approval_status, org.reviewed_by_user_id, org.reviewed_at = "rejected", admin.id, datetime.now(UTC)
    org.rejection_reason = reason
    record_audit(db, "admin.organization_rejected", organization_id=org.id, actor_user_id=admin.id,
                 target_type="organization", target_id=org.id, details={"reason": reason})  # fmt: skip
    await db.commit()
    owner = await _owner(db, org)
    if owner:
        await send_email_safely(OutgoingEmail(
            to=owner.email, subject=f"Your WFlow AI request for {org.name}",
            text=f"Thanks for your interest. We couldn't approve {org.name} at this time.\n\nReason: {reason}\n",
        ))  # fmt: skip
    return org


async def set_billing(db: AsyncSession, admin: User, org_id: uuid.UUID, *, billing_required: bool,
                      plan_key: str | None, trial_days: int | None) -> Organization:  # fmt: skip
    org = await _org(db, admin, org_id)
    previous = org.billing_required
    await _apply_billing(db, org, billing_required, plan_key, trial_days)
    record_audit(db, "admin.billing_changed", organization_id=org.id, actor_user_id=admin.id,
                 target_type="organization", target_id=org.id,
                 details={"billing_required": billing_required, "previous": previous, "plan": plan_key,
                          "trial_days": trial_days})  # fmt: skip
    await db.commit()
    return org


async def update_settings(
    db: AsyncSession, admin: User, org_id: uuid.UUID, changes: dict[str, Any]
) -> Organization:
    org = await _org(db, admin, org_id)
    for key, value in changes.items():
        setattr(org, key, value)
    record_audit(db, "admin.organization_updated", organization_id=org.id, actor_user_id=admin.id,
                 target_type="organization", target_id=org.id, details=changes)  # fmt: skip
    await db.commit()
    return org


# --- Organization detail tabs ---------------------------------------------------------------


async def org_channels(db: AsyncSession, admin: User, org_id: uuid.UUID) -> list[dict[str, Any]]:
    await _org(db, admin, org_id)
    rows = await db.scalars(
        select(ChannelConnection).where(ChannelConnection.organization_id == org_id, ChannelConnection.deleted_at.is_(None))
        .order_by(ChannelConnection.created_at)
    )  # fmt: skip
    return [
        {
            "id": c.id,
            "display_name": c.display_name,
            "channel_type": c.channel_type,
            "phone_number": c.phone_number,
            "account_name": c.account_name,
            "status": c.status,
            "status_detail": c.status_detail,
            "last_connected_at": getattr(c, "last_connected_at", None),
            "created_at": c.created_at,
        }  # fmt: skip
        for c in rows.all()
    ]


async def org_members(db: AsyncSession, admin: User, org_id: uuid.UUID) -> list[dict[str, Any]]:
    await _org(db, admin, org_id)
    rows = await db.scalars(select(OrganizationMember).where(OrganizationMember.organization_id == org_id))
    return [
        {
            "id": m.id,
            "user_id": m.user_id,
            "full_name": m.user.full_name,
            "email": m.user.email,
            "role": m.role.name,
            "status": m.status,
            "last_login_at": m.user.last_login_at,
            "user_active": m.user.is_active,
        }  # fmt: skip
        for m in rows.unique().all()
    ]


async def org_invoices(db: AsyncSession, admin: User, org_id: uuid.UUID) -> list[InvoiceRecord]:
    await _org(db, admin, org_id)
    return list((await db.scalars(
        select(InvoiceRecord).where(InvoiceRecord.organization_id == org_id).order_by(InvoiceRecord.created_at.desc())
    )).all())  # fmt: skip


async def org_activity(db: AsyncSession, since_days: int = 30) -> dict[uuid.UUID, dict[str, Any]]:
    since = datetime.now(UTC) - timedelta(days=since_days)
    rows = await db.execute(text("SELECT * FROM org_activity_stats(:s)"), {"s": since})
    return {r.organization_id: dict(r._mapping) for r in rows}


async def platform_stats(db: AsyncSession, days: int) -> dict[str, Any]:
    since = datetime.now(UTC) - timedelta(days=days)
    stats = dict(await db.scalar(text("SELECT platform_stats(:s)"), {"s": since}) or {})
    plans = await db.execute(text(
        "SELECT p.key, p.name, count(*) AS n FROM subscriptions s JOIN plans p ON p.id = s.plan_id "
        "JOIN organizations o ON o.id = s.organization_id WHERE o.deleted_at IS NULL GROUP BY p.key, p.name"
    ))  # fmt: skip
    stats["plans"] = [{"key": k, "name": n, "organizations": c} for k, n, c in plans.all()]
    billing = await db.execute(text(
        "SELECT billing_required, count(*) FROM organizations WHERE deleted_at IS NULL "
        "AND approval_status = 'approved' GROUP BY billing_required"
    ))  # fmt: skip
    stats["billing_on"] = stats["billing_off"] = 0
    for required, n in billing.all():
        stats["billing_on" if required else "billing_off"] = n
    stats["days"] = days
    return stats


# --- Users & logins ------------------------------------------------------------------------


async def list_users(
    db: AsyncSession, q: str | None, page: int, page_size: int
) -> tuple[list[dict[str, Any]], int]:
    query = select(User)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.where(or_(func.lower(User.email).like(like), func.lower(User.full_name).like(like)))
    total = await db.scalar(select(func.count()).select_from(query.subquery())) or 0
    users = (
        await db.scalars(
            query.order_by(User.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
        )
    ).all()
    counts = dict((await db.execute(
        select(OrganizationMember.user_id, func.count()).where(OrganizationMember.user_id.in_([u.id for u in users]))
        .group_by(OrganizationMember.user_id)
    )).all())  # fmt: skip
    return [_user_out(u, counts.get(u.id, 0)) for u in users], total


def _user_out(u: User, org_count: int) -> dict[str, Any]:
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "is_active": u.is_active,
            "is_superadmin": u.is_superadmin, "email_verified": u.email_verified_at is not None,
            "last_login_at": u.last_login_at, "created_at": u.created_at, "organizations": org_count}  # fmt: skip


async def user_detail(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    memberships = (await db.execute(
        select(OrganizationMember, Organization).join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(OrganizationMember.user_id == user_id)
    )).unique().all()  # fmt: skip
    sessions = await db.scalar(select(func.count()).select_from(RefreshToken).where(
        RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None), RefreshToken.expires_at > func.now()))  # fmt: skip
    logins = (await db.scalars(
        select(AuditLog).where(AuditLog.actor_user_id == user_id, AuditLog.action.like("auth.%"))
        .order_by(AuditLog.created_at.desc()).limit(25)
    )).all()  # fmt: skip
    failed = (await db.scalars(
        select(AuditLog).where(AuditLog.action == "auth.login_failed", AuditLog.details["email"].astext == user.email)
        .order_by(AuditLog.created_at.desc()).limit(10)
    )).all()  # fmt: skip
    events = sorted([*logins, *failed], key=lambda a: a.created_at, reverse=True)[:25]
    return {
        **_user_out(user, len(memberships)),
        "memberships": [{"organization_id": o.id, "organization_name": o.name, "role": m.role.name, "status": m.status}
                        for m, o in memberships],
        "active_sessions": sessions or 0,
        "login_events": [{"action": e.action, "at": e.created_at, "ip": e.ip_address, "user_agent": e.user_agent,
                          "reason": (e.details or {}).get("reason")} for e in events],
    }  # fmt: skip


async def set_user_active(db: AsyncSession, admin: User, user_id: uuid.UUID, active: bool) -> dict[str, Any]:
    if user_id == admin.id:
        raise AppError("You can't disable your own account", code="cannot_disable_self")
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    user.is_active = active
    if not active:
        await _revoke_sessions(db, user_id)
    record_audit(db, "admin.user_enabled" if active else "admin.user_disabled", actor_user_id=admin.id,
                 target_type="user", target_id=user_id)  # fmt: skip
    await db.commit()
    return await user_detail(db, user_id)


async def _revoke_sessions(db: AsyncSession, user_id: uuid.UUID) -> int:
    res = await db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
                           .values(revoked_at=func.now(), revoked_reason="admin"))  # fmt: skip
    return int(getattr(res, "rowcount", 0) or 0)


async def sign_out_everywhere(db: AsyncSession, admin: User, user_id: uuid.UUID) -> int:
    if await db.get(User, user_id) is None:
        raise NotFoundError("User not found")
    revoked = await _revoke_sessions(db, user_id)
    record_audit(db, "admin.user_signed_out", actor_user_id=admin.id, target_type="user", target_id=user_id,
                 details={"sessions": revoked})  # fmt: skip
    await db.commit()
    return revoked


async def set_superadmin(db: AsyncSession, admin: User, user_id: uuid.UUID, value: bool) -> dict[str, Any]:
    if user_id == admin.id and not value:
        raise AppError("You can't remove your own Super Admin access", code="cannot_demote_self")
    user = await db.get(User, user_id)
    if user is None:
        raise NotFoundError("User not found")
    user.is_superadmin = value
    record_audit(db, "admin.superadmin_granted" if value else "admin.superadmin_revoked", actor_user_id=admin.id,
                 target_type="user", target_id=user_id)  # fmt: skip
    await db.commit()
    return await user_detail(db, user_id)
