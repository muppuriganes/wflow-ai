import base64
import hashlib
import os
import uuid

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import ConflictError, NotFoundError
from app.models.commercial import IntegrationCredential
from app.schemas.commercial import CredentialCreateIn, CredentialOut
from app.services.audit import record_audit
from app.services.organizations import OrgContext


def _get_aes_key() -> bytes:
    raw_key = get_settings().credentials_encryption_key.encode("utf-8")
    return hashlib.sha256(raw_key).digest()


def encrypt_secret(secret: str) -> str:
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, secret.encode("utf-8"), None)
    return base64.b64encode(nonce + ciphertext).decode("ascii")


def decrypt_secret(encrypted_secret: str) -> str:
    key = _get_aes_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(encrypted_secret.encode("ascii"))
    nonce = raw[:12]
    ciphertext = raw[12:]
    decrypted = aesgcm.decrypt(nonce, ciphertext, None)
    return decrypted.decode("utf-8")


def mask_secret(secret: str) -> str:
    if len(secret) <= 4:
        return "••••"
    return f"••••{secret[-4:]}"


async def create_credential(db: AsyncSession, ctx: OrgContext, data: CredentialCreateIn) -> CredentialOut:
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    existing = await db.scalar(
        select(IntegrationCredential).where(
            IntegrationCredential.organization_id == ctx.org_id,
            IntegrationCredential.name == data.name,
        )
    )
    if existing:
        raise ConflictError(f"A credential named '{data.name}' already exists", code="credential_exists")

    encrypted = encrypt_secret(data.secret)
    masked = mask_secret(data.secret)

    cred = IntegrationCredential(
        organization_id=ctx.org_id,
        name=data.name,
        type=data.type,
        encrypted_secret=encrypted,
        masked_secret=masked,
    )
    db.add(cred)
    await db.flush()

    record_audit(
        db,
        "credential.created",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="credential",
        target_id=cred.id,
        details={"name": cred.name, "type": cred.type},
    )
    await db.commit()

    return CredentialOut.model_validate(cred)


async def list_credentials(db: AsyncSession, ctx: OrgContext) -> list[CredentialOut]:
    ctx.require("integrations.read")
    res = await db.execute(
        select(IntegrationCredential)
        .where(IntegrationCredential.organization_id == ctx.org_id)
        .order_by(IntegrationCredential.name.asc())
    )
    return [CredentialOut.model_validate(c) for c in res.scalars().all()]


async def delete_credential(db: AsyncSession, ctx: OrgContext, credential_id: uuid.UUID) -> None:
    ctx.require("integrations.manage")
    ctx.require_not_suspended()

    cred = await db.get(IntegrationCredential, credential_id)
    if not cred or cred.organization_id != ctx.org_id:
        raise NotFoundError("Credential not found", code="credential_not_found")

    record_audit(
        db,
        "credential.deleted",
        organization_id=ctx.org_id,
        actor_user_id=ctx.user.id,
        target_type="credential",
        target_id=cred.id,
        details={"name": cred.name},
    )
    await db.delete(cred)
    await db.commit()


async def get_decrypted_secret(
    db: AsyncSession, org_id: uuid.UUID, credential_id: uuid.UUID
) -> tuple[str, str]:
    """Internal helper to retrieve and decrypt a credential for activity execution."""
    res = await db.execute(
        select(IntegrationCredential).where(
            IntegrationCredential.id == credential_id,
            IntegrationCredential.organization_id == org_id,
        )
    )
    cred = res.scalar_one_or_none()
    if not cred:
        raise NotFoundError(f"Credential '{credential_id}' not found", code="credential_not_found")

    decrypted = decrypt_secret(cred.encrypted_secret)
    return cred.type, decrypted
