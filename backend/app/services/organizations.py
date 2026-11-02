import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.email import OutgoingEmail, send_email_safely
from app.core.errors import AppError, ConflictError, NotFoundError, PermissionDeniedError
from app.core.rbac import OWNER_ROLE_KEY
from app.core.security import generate_token, hash_token
from app.database.session import set_rls_context
from app.models import Invitation, Organization, OrganizationMember, Role, User
from app.schemas.organization import OrganizationCreate, OrganizationUpdate
from app.services import plans
from app.services.audit import record_audit


@dataclass
class OrgContext:
    """The resolved tenant for a request: who is acting, in which org, with which rights."""

    user: User
    organization: Organization
    membership: OrganizationMember
    permissions: frozenset[str]

    @property
    def org_id(self) -> uuid.UUID:
        return self.organization.id

    @property
    def user_id(self) -> uuid.UUID:
        return self.user.id

    @property
    def is_suspended(self) -> bool:
        return self.organization.status == "suspended"

    def require_not_suspended(self) -> None:
        if self.is_suspended:
            from app.core.errors import OrganizationSuspendedError

            raise OrganizationSuspendedError(
                "This organization is currently suspended. Please contact support.",
                details={"reason": self.organization.suspended_reason},
            )

    @property
    def rank(self) -> int:
        return self.membership.role.rank

    def require(self, permission: str) -> None:
        if permission not in self.permissions:
            raise PermissionDeniedError(f"Missing permission: {permission}", code="missing_permission")

    def require_any(self, *permissions: str) -> None:
        if not any(p in self.permissions for p in permissions):
            raise PermissionDeniedError(
                f"Missing one of permissions: {', '.join(permissions)}", code="missing_permission"
            )


def _slugify(name: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:60] or "org"
    return f"{base}-{secrets.token_hex(3)}"


async def get_system_role(db: AsyncSession, key: str) -> Role:
    role = await db.scalar(select(Role).where(Role.key == key, Role.organization_id.is_(None)))
    if role is None:
        raise RuntimeError(f"System role '{key}' missing — run `python -m app.cli sync-rbac`")
    return role


async def get_assignable_role(db: AsyncSession, key: str) -> Role:
    """System roles plus the active org's custom roles (RLS limits the latter)."""
    role = await db.scalar(
        select(Role).where(Role.key == key).order_by(Role.organization_id.is_(None))  # org-specific first
    )
    if role is None:
        raise AppError(f"Unknown role '{key}'", code="unknown_role")
    return role


async def create_organization(db: AsyncSession, user: User, data: OrganizationCreate) -> Organization:
    """Creates the org and makes `user` its owner. Caller commits."""
    owned = await db.scalar(
        select(func.count()).select_from(OrganizationMember).where(OrganizationMember.user_id == user.id)
    )
    if (owned or 0) >= get_settings().max_organizations_per_user:
        raise AppError("Organization limit reached", code="organization_limit")

    org = Organization(
        id=uuid.uuid4(),
        name=data.name,
        slug=_slugify(data.name),
        timezone=data.timezone,
        created_by_user_id=user.id,
    )
    # The RLS insert policy only accepts rows for the active org, so switch to it first.
    await set_rls_context(db, org_id=org.id)
    db.add(org)
    await db.flush()
    owner_role = await get_system_role(db, OWNER_ROLE_KEY)
    db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role_id=owner_role.id))
    record_audit(
        db,
        "organization.created",
        organization_id=org.id,
        actor_user_id=user.id,
        target_type="organization",
        target_id=org.id,
        details={"name": org.name},
    )
    await db.flush()
    await plans.get_or_create_subscription(db, org.id)
    return org


async def list_user_memberships(
    db: AsyncSession, user_id: uuid.UUID
) -> list[tuple[OrganizationMember, Organization]]:
    await set_rls_context(db, org_id=None)
    rows = await db.execute(
        select(OrganizationMember, Organization)
        .join(Organization, Organization.id == OrganizationMember.organization_id)
        .where(
            OrganizationMember.user_id == user_id,
            OrganizationMember.status == "active",
            Organization.deleted_at.is_(None),
        )
        .order_by(Organization.name)
    )
    return [(membership, org) for membership, org in rows.unique().all()]


async def resolve_org_context(db: AsyncSession, user: User, org_id: uuid.UUID) -> OrgContext:
    """Switches the session to `org_id` and verifies the user is an active member.
    Non-members get 404 (not 403) so organization ids cannot be probed."""
    await set_rls_context(db, org_id=org_id)
    row = (
        await db.execute(
            select(OrganizationMember, Organization)
            .join(Organization, Organization.id == OrganizationMember.organization_id)
            .where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == user.id,
                OrganizationMember.status == "active",
                Organization.deleted_at.is_(None),
            )
        )
    ).first()
    if row is None:
        raise NotFoundError("Organization not found")
    membership, org = row
    permissions = frozenset(p.code for p in membership.role.permissions)
    return OrgContext(user=user, organization=org, membership=membership, permissions=permissions)


async def update_organization(db: AsyncSession, ctx: OrgContext, data: OrganizationUpdate) -> Organization:
    ctx.require("org.update")
    changes = data.model_dump(exclude_unset=True, exclude_none=True)
    for field, value in changes.items():
        setattr(ctx.organization, field, value)
    record_audit(
        db,
        "organization.updated",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="organization",
        target_id=ctx.org_id,
        details=changes,
    )
    await db.commit()
    await db.refresh(ctx.organization)
    return ctx.organization


async def delete_organization(db: AsyncSession, ctx: OrgContext) -> None:
    """Soft delete: data is retained for the recovery window, access stops immediately."""
    ctx.require("org.delete")
    ctx.organization.deleted_at = datetime.now(UTC)
    record_audit(
        db,
        "organization.deleted",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="organization",
        target_id=ctx.org_id,
    )
    await db.commit()


# --- Members ------------------------------------------------------------------------


async def list_members(db: AsyncSession, ctx: OrgContext) -> list[OrganizationMember]:
    ctx.require("members.read")
    result = await db.scalars(
        select(OrganizationMember)
        .where(OrganizationMember.organization_id == ctx.org_id)
        .order_by(OrganizationMember.created_at)
    )
    return list(result.unique().all())


async def _get_member(db: AsyncSession, ctx: OrgContext, member_id: uuid.UUID) -> OrganizationMember:
    member = await db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.id == member_id, OrganizationMember.organization_id == ctx.org_id
        )
    )
    if member is None:
        raise NotFoundError("Member not found")
    return member


async def _owner_count(db: AsyncSession, org_id: uuid.UUID) -> int:
    count = await db.scalar(
        select(func.count())
        .select_from(OrganizationMember)
        .join(Role, Role.id == OrganizationMember.role_id)
        .where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.status == "active",
            Role.key == OWNER_ROLE_KEY,
        )
    )
    return count or 0


async def update_member_role(
    db: AsyncSession, ctx: OrgContext, member_id: uuid.UUID, role_key: str
) -> OrganizationMember:
    ctx.require("members.update")
    member = await _get_member(db, ctx, member_id)
    if member.user_id == ctx.user.id:
        raise PermissionDeniedError("You cannot change your own role", code="self_role_change")
    new_role = await get_assignable_role(db, role_key)
    if member.role.rank > ctx.rank or new_role.rank > ctx.rank:
        raise PermissionDeniedError("You cannot manage a role above your own", code="role_rank")
    if (
        member.role.key == OWNER_ROLE_KEY
        and new_role.key != OWNER_ROLE_KEY
        and await _owner_count(db, ctx.org_id) <= 1
    ):
        raise ConflictError("An organization must keep at least one owner", code="last_owner")
    old_key = member.role.key
    member.role_id = new_role.id
    record_audit(
        db,
        "member.role_changed",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="member",
        target_id=member.id,
        details={"user_id": str(member.user_id), "from": old_key, "to": new_role.key},
    )
    await db.commit()
    await db.refresh(member, ["role"])
    return member


async def remove_member(db: AsyncSession, ctx: OrgContext, member_id: uuid.UUID) -> None:
    member = await _get_member(db, ctx, member_id)
    leaving_self = member.user_id == ctx.user.id
    if not leaving_self:
        ctx.require("members.remove")
        if member.role.rank > ctx.rank:
            raise PermissionDeniedError("You cannot remove a member above your role", code="role_rank")
    if member.role.key == OWNER_ROLE_KEY and await _owner_count(db, ctx.org_id) <= 1:
        raise ConflictError("An organization must keep at least one owner", code="last_owner")
    record_audit(
        db,
        "member.left" if leaving_self else "member.removed",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="member",
        target_id=member.id,
        details={"user_id": str(member.user_id), "email": member.user.email},
    )
    await db.delete(member)
    await db.commit()


# --- Invitations --------------------------------------------------------------------


def invitation_status(inv: Invitation) -> str:
    if inv.accepted_at:
        return "accepted"
    if inv.revoked_at:
        return "revoked"
    if inv.expires_at <= datetime.now(UTC):
        return "expired"
    return "pending"


async def create_invitation(db: AsyncSession, ctx: OrgContext, email: str, role_key: str) -> Invitation:
    ctx.require("members.invite")
    ctx.require_not_suspended()
    await plans.check_resource_limit(db, ctx.org_id, "max_members")
    email = email.strip().lower()
    role = await get_assignable_role(db, role_key)
    if role.rank > ctx.rank:
        raise PermissionDeniedError("You cannot invite someone to a role above your own", code="role_rank")

    already_member = await db.scalar(
        select(OrganizationMember.id)
        .join(User, User.id == OrganizationMember.user_id)
        .where(OrganizationMember.organization_id == ctx.org_id, User.email == email)
    )
    if already_member:
        raise ConflictError("This person is already a member", code="already_member")

    # Re-inviting replaces any open invitation (acts as "resend").
    open_invites = await db.scalars(
        select(Invitation).where(
            Invitation.organization_id == ctx.org_id,
            Invitation.email == email,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
    )
    now = datetime.now(UTC)
    for old in open_invites.unique():
        old.revoked_at = now
    await db.flush()

    token = generate_token()
    invitation = Invitation(
        organization_id=ctx.org_id,
        email=email,
        role_id=role.id,
        token_hash=hash_token(token),
        invited_by_user_id=ctx.user.id,
        expires_at=now + timedelta(days=get_settings().invitation_ttl_days),
    )
    db.add(invitation)
    record_audit(
        db,
        "invitation.created",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="invitation",
        details={"email": email, "role": role.key},
    )
    await db.commit()
    await db.refresh(invitation, ["role"])

    link = f"{get_settings().frontend_url}/invite/{token}"
    await send_email_safely(
        OutgoingEmail(
            to=email,
            subject=f"You're invited to join {ctx.organization.name} on WFlow AI",
            text=(
                f"{ctx.user.full_name} invited you to join {ctx.organization.name} as {role.name}.\n\n"
                f"Accept the invitation: {link}\n\n"
                f"This link expires in {get_settings().invitation_ttl_days} days."
            ),
        )
    )
    return invitation


async def list_invitations(db: AsyncSession, ctx: OrgContext) -> list[Invitation]:
    ctx.require("members.read")
    result = await db.scalars(
        select(Invitation)
        .where(
            Invitation.organization_id == ctx.org_id,
            Invitation.accepted_at.is_(None),
            Invitation.revoked_at.is_(None),
        )
        .order_by(Invitation.created_at.desc())
    )
    return list(result.unique().all())


async def revoke_invitation(db: AsyncSession, ctx: OrgContext, invitation_id: uuid.UUID) -> None:
    ctx.require("members.invite")
    invitation = await db.scalar(
        select(Invitation).where(Invitation.id == invitation_id, Invitation.organization_id == ctx.org_id)
    )
    if invitation is None or invitation_status(invitation) != "pending":
        raise NotFoundError("Invitation not found")
    invitation.revoked_at = datetime.now(UTC)
    record_audit(
        db,
        "invitation.revoked",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="invitation",
        target_id=invitation.id,
        details={"email": invitation.email},
    )
    await db.commit()


async def _load_invitation_by_token(db: AsyncSession, token: str) -> tuple[Invitation, Organization]:
    token_hash = hash_token(token)
    org_id = await db.scalar(select(func.invitation_org_by_token_hash(token_hash)))
    if org_id is None:
        raise NotFoundError("Invitation not found")
    await set_rls_context(db, org_id=org_id)
    invitation = await db.scalar(select(Invitation).where(Invitation.token_hash == token_hash))
    org = await db.get(Organization, org_id)
    if invitation is None or org is None or org.deleted_at is not None:
        raise NotFoundError("Invitation not found")
    return invitation, org


async def preview_invitation(db: AsyncSession, token: str) -> tuple[Invitation, Organization]:
    return await _load_invitation_by_token(db, token)


async def accept_invitation(db: AsyncSession, user: User, token: str) -> Organization:
    invitation, org = await _load_invitation_by_token(db, token)
    if invitation_status(invitation) != "pending":
        raise AppError(f"This invitation is {invitation_status(invitation)}", code="invitation_unusable")
    if invitation.email != user.email:
        raise PermissionDeniedError(
            "This invitation was sent to a different email address", code="invitation_email_mismatch"
        )
    exists = await db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == org.id, OrganizationMember.user_id == user.id
        )
    )
    now = datetime.now(UTC)
    if not exists:
        db.add(OrganizationMember(organization_id=org.id, user_id=user.id, role_id=invitation.role_id))
    invitation.accepted_at = now
    # Receiving the invitation link proves control of the mailbox.
    if user.email_verified_at is None:
        user.email_verified_at = now
    record_audit(
        db,
        "invitation.accepted",
        organization_id=org.id,
        actor_user_id=user.id,
        target_type="invitation",
        target_id=invitation.id,
        details={"role": invitation.role.key},
    )
    await db.commit()
    return org
