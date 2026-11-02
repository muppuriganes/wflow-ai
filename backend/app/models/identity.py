import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey


class User(UUIDPrimaryKey, Timestamps, Base):
    """Platform-level identity. Not tenant-owned: one user can belong to many organizations."""

    __tablename__ = "users"

    email: Mapped[str] = mapped_column(String(320), unique=True)  # always stored lower-cased
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(200))
    email_verified_at: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    last_login_at: Mapped[datetime | None]
    password_changed_at: Mapped[datetime | None]


class Organization(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(200))
    slug: Mapped[str] = mapped_column(String(80), unique=True)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC", server_default="UTC")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    deleted_at: Mapped[datetime | None]
    status: Mapped[str] = mapped_column(String(32), default="active", server_default=text("'active'"))
    suspended_at: Mapped[datetime | None]
    suspended_reason: Mapped[str | None] = mapped_column(String(255), default=None)
    # Sign-up requests wait for a Super Admin: pending | approved | rejected
    approval_status: Mapped[str] = mapped_column(String(16), default="approved", server_default="approved")
    request_details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    reviewed_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reviewed_at: Mapped[datetime | None]
    rejection_reason: Mapped[str | None] = mapped_column(String(500), default=None)
    # Billing on: the organization must pay (or be in a trial) to use the workspace.
    billing_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    # Owner-granted window in which a Super Admin may open the workspace read-only.
    support_access_until: Mapped[datetime | None]


class Permission(UUIDPrimaryKey, Base):
    __tablename__ = "permissions"

    code: Mapped[str] = mapped_column(String(100), unique=True)
    category: Mapped[str] = mapped_column(String(50))
    description: Mapped[str] = mapped_column(String(255))


class Role(UUIDPrimaryKey, Timestamps, Base):
    """organization_id NULL = built-in system role shared by all organizations."""

    __tablename__ = "roles"
    __table_args__ = (
        UniqueConstraint("organization_id", "key", name="uq_roles_org_key"),
        Index("uq_roles_system_key", "key", unique=True, postgresql_where=text("organization_id IS NULL")),
    )

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    key: Mapped[str] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(255), default="")
    rank: Mapped[int] = mapped_column(Integer)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))

    permissions: Mapped[list[Permission]] = relationship(secondary="role_permissions", lazy="selectin")


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("permissions.id", ondelete="CASCADE"), primary_key=True, index=True
    )


class OrganizationMember(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "organization_members"
    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_organization_members_org_user"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="RESTRICT"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")

    user: Mapped[User] = relationship(lazy="joined")
    role: Mapped[Role] = relationship(lazy="joined")


class Invitation(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "invitations"
    __table_args__ = (
        # At most one open invitation per email per organization.
        Index(
            "uq_invitations_open_email",
            "organization_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), index=True
    )
    email: Mapped[str] = mapped_column(String(320))
    role_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    expires_at: Mapped[datetime]
    accepted_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]

    role: Mapped[Role] = relationship(lazy="joined")


class RefreshToken(UUIDPrimaryKey, CreatedAt, Base):
    """Rotating refresh tokens. Every login starts a `family`; each refresh replaces the token.
    Presenting an already-rotated token revokes the whole family (token theft detection)."""

    __tablename__ = "refresh_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    revoked_reason: Mapped[str | None] = mapped_column(String(50))
    replaced_by_id: Mapped[uuid.UUID | None]
    user_agent: Mapped[str | None] = mapped_column(String(500))
    ip_address: Mapped[str | None] = mapped_column(String(64))
    last_used_at: Mapped[datetime | None]


class UserActionToken(UUIDPrimaryKey, CreatedAt, Base):
    """Single-use tokens for email verification and password reset."""

    __tablename__ = "user_action_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(30))  # "verify_email" | "reset_password"
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
