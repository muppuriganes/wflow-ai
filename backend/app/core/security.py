import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt
from pwdlib import PasswordHash

from app.core.config import get_settings
from app.core.errors import AuthenticationError

_password_hash = PasswordHash.recommended()  # Argon2id

# Hash of a random password; used to keep login timing constant for unknown emails.
DUMMY_PASSWORD_HASH = _password_hash.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _password_hash.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return _password_hash.verify(password, password_hash)


def generate_token() -> str:
    """Opaque random token handed to clients (refresh tokens, email links, invitations)."""
    return secrets.token_urlsafe(48)


def hash_token(token: str) -> str:
    """Only SHA-256 digests of opaque tokens are stored, so a database leak does not leak live tokens."""
    return hashlib.sha256(token.encode()).hexdigest()


def create_access_token(user_id: uuid.UUID, *, is_superadmin: bool = False) -> tuple[str, int]:
    settings = get_settings()
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + ttl,
        "jti": uuid.uuid4().hex,
        "typ": "access",
        "sa": is_superadmin,
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    return token, int(ttl.total_seconds())


def decode_access_token(token: str) -> uuid.UUID:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            options={"require": ["exp", "sub", "typ"]},
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthenticationError("Access token expired", code="token_expired") from exc
    except jwt.PyJWTError as exc:
        raise AuthenticationError("Invalid access token") from exc
    if payload.get("typ") != "access":
        raise AuthenticationError("Invalid access token")
    try:
        return uuid.UUID(payload["sub"])
    except ValueError as exc:
        raise AuthenticationError("Invalid access token") from exc
