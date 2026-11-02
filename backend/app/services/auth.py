import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.email import OutgoingEmail, send_email_safely
from app.core.errors import AccountLockedError, AppError, AuthenticationError, ConflictError
from app.core.metrics import AUTH_FAILED_LOGINS_TOTAL, AUTH_LOCKOUTS_TOTAL
from app.core.rate_limit import get_redis
from app.core.request_context import get_request_meta
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    generate_token,
    hash_password,
    hash_token,
    verify_password,
)
from app.database.session import set_rls_context
from app.models import RefreshToken, User, UserActionToken
from app.schemas.auth import RegisterRequest
from app.schemas.organization import OrganizationCreate
from app.services.audit import record_audit
from app.services.organizations import create_organization

VERIFY_EMAIL = "verify_email"
RESET_PASSWORD = "reset_password"


@dataclass
class IssuedTokens:
    access_token: str
    expires_in: int
    refresh_token: str
    user: User


def _normalize_email(email: str) -> str:
    return email.strip().lower()


async def _issue_tokens(
    db: AsyncSession, user: User, family_id: uuid.UUID | None = None
) -> tuple[IssuedTokens, RefreshToken]:
    meta = get_request_meta()
    refresh = generate_token()
    record = RefreshToken(
        id=uuid.uuid4(),
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        token_hash=hash_token(refresh),
        expires_at=datetime.now(UTC) + timedelta(days=get_settings().refresh_token_ttl_days),
        user_agent=(meta.user_agent or "")[:500] or None,
        ip_address=meta.ip_address,
    )
    db.add(record)
    access, expires_in = create_access_token(user.id, is_superadmin=user.is_superadmin)
    return IssuedTokens(access, expires_in, refresh, user), record


async def _create_action_token(db: AsyncSession, user: User, purpose: str, ttl: timedelta) -> str:
    # A new link invalidates earlier unused ones for the same purpose.
    now = datetime.now(UTC)
    await db.execute(
        update(UserActionToken)
        .where(
            UserActionToken.user_id == user.id,
            UserActionToken.purpose == purpose,
            UserActionToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    token = generate_token()
    db.add(
        UserActionToken(user_id=user.id, purpose=purpose, token_hash=hash_token(token), expires_at=now + ttl)
    )
    return token


async def _consume_action_token(db: AsyncSession, token: str, purpose: str) -> User:
    record = await db.scalar(
        select(UserActionToken).where(UserActionToken.token_hash == hash_token(token)).with_for_update()
    )
    now = datetime.now(UTC)
    if record is None or record.purpose != purpose or record.used_at is not None or record.expires_at <= now:
        raise AppError("This link is invalid or has expired", code="invalid_token")
    record.used_at = now
    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise AppError("This link is invalid or has expired", code="invalid_token")
    await set_rls_context(db, user_id=user.id)
    return user


async def _send_verification(user: User, token: str) -> None:
    link = f"{get_settings().frontend_url}/verify-email?token={token}"
    await send_email_safely(
        OutgoingEmail(
            to=user.email,
            subject="Verify your email for WFlow AI",
            text=f"Hi {user.full_name},\n\nConfirm your email address: {link}\n\n"
            f"If you did not create a WFlow AI account, ignore this message.",
        )
    )


async def register(db: AsyncSession, data: RegisterRequest) -> IssuedTokens:
    email = _normalize_email(data.email)
    if await db.scalar(select(User.id).where(User.email == email)):
        raise ConflictError("An account with this email already exists", code="email_taken")

    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=hash_password(data.password),
        full_name=data.full_name,
        last_login_at=datetime.now(UTC),
    )
    db.add(user)
    await db.flush()
    await set_rls_context(db, user_id=user.id)
    if data.organization_name:
        await create_organization(db, user, OrganizationCreate(name=data.organization_name))
        await set_rls_context(db, org_id=None)
    record_audit(db, "auth.registered", actor_user_id=user.id, target_type="user", target_id=user.id)
    verify_token = await _create_action_token(
        db, user, VERIFY_EMAIL, timedelta(hours=get_settings().email_verification_ttl_hours)
    )
    tokens, _ = await _issue_tokens(db, user)
    await db.commit()
    await _send_verification(user, verify_token)
    return tokens


MAX_FAILED_LOGINS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes


async def login(db: AsyncSession, email: str, password: str) -> IssuedTokens:
    email = _normalize_email(email)
    redis = get_redis()
    lockout_key = f"auth:lockout:{email}"
    attempts_key = f"auth:fails:{email}"

    if await redis.get(lockout_key):
        AUTH_LOCKOUTS_TOTAL.inc()
        raise AccountLockedError(
            "Too many failed login attempts. Account temporarily locked for 15 minutes.",
            code="account_locked",
        )

    user = await db.scalar(select(User).where(User.email == email))
    # Always run one hash verification so response time does not reveal whether the email exists.
    valid = verify_password(password, user.password_hash if user else DUMMY_PASSWORD_HASH)
    if user is None or not valid or not user.is_active:
        AUTH_FAILED_LOGINS_TOTAL.inc()
        fails = await redis.incr(attempts_key)
        if fails == 1:
            await redis.expire(attempts_key, LOCKOUT_DURATION_SECONDS)
        elif fails >= MAX_FAILED_LOGINS:
            await redis.set(lockout_key, "1", ex=LOCKOUT_DURATION_SECONDS)
            await redis.delete(attempts_key)
            AUTH_LOCKOUTS_TOTAL.inc()

        if user is not None:
            await set_rls_context(db, user_id=user.id)
        record_audit(
            db,
            "auth.login_failed",
            actor_user_id=user.id if user else None,
            details={
                "email": email,
                "reason": "inactive" if valid and user else "bad_credentials",
                "failed_attempts": fails,
            },
        )
        await db.commit()
        if fails >= MAX_FAILED_LOGINS:
            raise AccountLockedError(
                "Too many failed login attempts. Account temporarily locked for 15 minutes.",
                code="account_locked",
            )
        raise AuthenticationError("Invalid email or password", code="invalid_credentials")

    # Successful login: clear failure tracking
    await redis.delete(attempts_key, lockout_key)
    await set_rls_context(db, user_id=user.id)
    user.last_login_at = datetime.now(UTC)
    tokens, _ = await _issue_tokens(db, user)
    record_audit(db, "auth.login", actor_user_id=user.id, target_type="user", target_id=user.id)
    await db.commit()
    return tokens


async def refresh(db: AsyncSession, refresh_token: str | None) -> IssuedTokens:
    if not refresh_token:
        raise AuthenticationError("Missing refresh token", code="refresh_missing")
    record = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)).with_for_update()
    )
    now = datetime.now(UTC)
    if record is None:
        raise AuthenticationError("Invalid refresh token", code="refresh_invalid")

    if record.revoked_at is not None:
        if record.revoked_reason == "rotated":
            # A token that was already exchanged is being replayed: assume theft, end the session.
            await revoke_family(db, record.family_id, reason="reuse_detected")
            await set_rls_context(db, user_id=record.user_id)
            record_audit(
                db,
                "auth.refresh_reuse_detected",
                actor_user_id=record.user_id,
                details={"family_id": str(record.family_id)},
            )
            await db.commit()
        raise AuthenticationError("Session has ended. Please sign in again.", code="refresh_revoked")
    if record.expires_at <= now:
        raise AuthenticationError("Session expired. Please sign in again.", code="refresh_expired")

    user = await db.get(User, record.user_id)
    if user is None or not user.is_active:
        raise AuthenticationError("Invalid refresh token", code="refresh_invalid")

    tokens, new_record = await _issue_tokens(db, user, family_id=record.family_id)
    new_record.last_used_at = now
    record.revoked_at = now
    record.revoked_reason = "rotated"
    record.replaced_by_id = new_record.id
    record.last_used_at = now
    await db.commit()
    return tokens


async def revoke_family(db: AsyncSession, family_id: uuid.UUID, *, reason: str) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC), revoked_reason=reason)
    )


async def family_of(db: AsyncSession, refresh_token: str | None) -> RefreshToken | None:
    if not refresh_token:
        return None
    return await db.scalar(select(RefreshToken).where(RefreshToken.token_hash == hash_token(refresh_token)))


async def logout(db: AsyncSession, refresh_token: str | None) -> None:
    record = await family_of(db, refresh_token)
    if record is not None:
        await revoke_family(db, record.family_id, reason="logout")
        await set_rls_context(db, user_id=record.user_id)
        record_audit(db, "auth.logout", actor_user_id=record.user_id)
        await db.commit()


async def revoke_all_sessions(
    db: AsyncSession, user: User, *, except_family: uuid.UUID | None = None
) -> None:
    stmt = update(RefreshToken).where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
    if except_family is not None:
        stmt = stmt.where(RefreshToken.family_id != except_family)
    await db.execute(stmt.values(revoked_at=datetime.now(UTC), revoked_reason="revoked_by_user"))


async def list_sessions(db: AsyncSession, user: User) -> list[RefreshToken]:
    """The live token of each session family (rotated tokens are history, not sessions)."""
    result = await db.scalars(
        select(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
        .order_by(RefreshToken.created_at.desc())
    )
    return list(result.all())


async def first_login_of_family(db: AsyncSession, family_id: uuid.UUID) -> datetime | None:
    return await db.scalar(
        select(RefreshToken.created_at)
        .where(RefreshToken.family_id == family_id)
        .order_by(RefreshToken.created_at)
        .limit(1)
    )


async def revoke_session(db: AsyncSession, user: User, family_id: uuid.UUID) -> None:
    result = await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == user.id,
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC), revoked_reason="revoked_by_user")
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise AppError("Session not found", code="not_found")
    record_audit(db, "auth.session_revoked", actor_user_id=user.id, details={"family_id": str(family_id)})
    await db.commit()


async def request_password_reset(db: AsyncSession, email: str) -> None:
    """Always succeeds from the caller's point of view (no account enumeration)."""
    user = await db.scalar(select(User).where(User.email == _normalize_email(email)))
    if user is None or not user.is_active:
        return
    await set_rls_context(db, user_id=user.id)
    ttl = get_settings().password_reset_ttl_minutes
    token = await _create_action_token(db, user, RESET_PASSWORD, timedelta(minutes=ttl))
    record_audit(db, "auth.password_reset_requested", actor_user_id=user.id)
    await db.commit()
    link = f"{get_settings().frontend_url}/reset-password?token={token}"
    await send_email_safely(
        OutgoingEmail(
            to=user.email,
            subject="Reset your WFlow AI password",
            text=f"Hi {user.full_name},\n\nReset your password: {link}\n\nThis link expires in {ttl} "
            "minutes. If you did not request this, you can ignore this email.",
        )
    )


async def reset_password(db: AsyncSession, token: str, new_password: str) -> None:
    user = await _consume_action_token(db, token, RESET_PASSWORD)
    user.password_hash = hash_password(new_password)
    user.password_changed_at = datetime.now(UTC)
    # Opening the reset link also proves mailbox ownership.
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    await revoke_all_sessions(db, user)
    record_audit(db, "auth.password_reset", actor_user_id=user.id)
    await db.commit()


async def verify_email(db: AsyncSession, token: str) -> User:
    user = await _consume_action_token(db, token, VERIFY_EMAIL)
    user.email_verified_at = user.email_verified_at or datetime.now(UTC)
    record_audit(db, "auth.email_verified", actor_user_id=user.id)
    await db.commit()
    return user


async def resend_verification(db: AsyncSession, user: User) -> None:
    if user.email_verified_at is not None:
        raise AppError("Email is already verified", code="already_verified")
    token = await _create_action_token(
        db, user, VERIFY_EMAIL, timedelta(hours=get_settings().email_verification_ttl_hours)
    )
    await db.commit()
    await _send_verification(user, token)


async def change_password(
    db: AsyncSession, user: User, current: str, new: str, *, current_family: uuid.UUID | None
) -> None:
    if not verify_password(current, user.password_hash):
        raise AppError("Current password is incorrect", code="wrong_password")
    user.password_hash = hash_password(new)
    user.password_changed_at = datetime.now(UTC)
    await revoke_all_sessions(db, user, except_family=current_family)
    record_audit(db, "auth.password_changed", actor_user_id=user.id)
    await db.commit()
