"""Integrations API: outgoing webhooks and encrypted credentials."""

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db, get_org_context
from app.schemas.commercial import (
    CredentialCreateIn,
    CredentialOut,
    WebhookCreateIn,
    WebhookCreateOut,
    WebhookDeliveryOut,
    WebhookOut,
    WebhookUpdateIn,
)
from app.services import credentials as creds_svc
from app.services import webhooks as webhooks_svc
from app.services.organizations import OrgContext

router = APIRouter()


# --- Webhooks -----------------------------------------------------------------


@router.post(
    "/organizations/{org_id}/webhooks",
    response_model=WebhookCreateOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_webhook(
    org_id: uuid.UUID,
    data: WebhookCreateIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> WebhookCreateOut:
    endpoint, secret = await webhooks_svc.create_webhook(db, ctx, data)
    await db.commit()
    out = WebhookCreateOut.model_validate(endpoint)
    out.secret_key = secret
    return out


@router.get(
    "/organizations/{org_id}/webhooks",
    response_model=list[WebhookOut],
)
async def list_webhooks(
    org_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookOut]:
    items = await webhooks_svc.list_webhooks(db, ctx)
    return [WebhookOut.model_validate(x) for x in items]


@router.get(
    "/organizations/{org_id}/webhooks/{webhook_id}",
    response_model=WebhookOut,
)
async def get_webhook(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> WebhookOut:
    endpoint = await webhooks_svc.get_webhook(db, ctx, webhook_id)
    return WebhookOut.model_validate(endpoint)


@router.patch(
    "/organizations/{org_id}/webhooks/{webhook_id}",
    response_model=WebhookOut,
)
async def update_webhook(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    data: WebhookUpdateIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> WebhookOut:
    endpoint = await webhooks_svc.update_webhook(db, ctx, webhook_id, data)
    await db.commit()
    return WebhookOut.model_validate(endpoint)


@router.delete(
    "/organizations/{org_id}/webhooks/{webhook_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_webhook(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    await webhooks_svc.delete_webhook(db, ctx, webhook_id)
    await db.commit()


@router.post(
    "/organizations/{org_id}/webhooks/{webhook_id}/ping",
    response_model=WebhookDeliveryOut,
)
async def ping_webhook(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> WebhookDeliveryOut:
    delivery = await webhooks_svc.ping_webhook(db, ctx, webhook_id)
    await db.commit()
    return WebhookDeliveryOut.model_validate(delivery)


@router.get(
    "/organizations/{org_id}/webhooks/{webhook_id}/deliveries",
    response_model=list[WebhookDeliveryOut],
)
async def list_webhook_deliveries(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    limit: int = Query(default=50, ge=1, le=100),
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookDeliveryOut]:
    items = await webhooks_svc.list_deliveries(db, ctx, webhook_id, limit=limit)
    return [WebhookDeliveryOut.model_validate(x) for x in items]


@router.post(
    "/organizations/{org_id}/webhooks/{webhook_id}/deliveries/{delivery_id}/redeliver",
    response_model=WebhookDeliveryOut,
)
async def redeliver_webhook(
    org_id: uuid.UUID,
    webhook_id: uuid.UUID,
    delivery_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> WebhookDeliveryOut:
    delivery = await webhooks_svc.redeliver_delivery(db, ctx, webhook_id, delivery_id)
    await db.commit()
    return WebhookDeliveryOut.model_validate(delivery)


# --- Credentials --------------------------------------------------------------


@router.post(
    "/organizations/{org_id}/credentials",
    response_model=CredentialOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_credential(
    org_id: uuid.UUID,
    data: CredentialCreateIn,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> CredentialOut:
    cred = await creds_svc.create_credential(db, ctx, data)
    await db.commit()
    return CredentialOut.model_validate(cred)


@router.get(
    "/organizations/{org_id}/credentials",
    response_model=list[CredentialOut],
)
async def list_credentials(
    org_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> list[CredentialOut]:
    items = await creds_svc.list_credentials(db, ctx)
    return [CredentialOut.model_validate(x) for x in items]


@router.delete(
    "/organizations/{org_id}/credentials/{credential_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_credential(
    org_id: uuid.UUID,
    credential_id: uuid.UUID,
    ctx: OrgContext = Depends(get_org_context),
    db: AsyncSession = Depends(get_db),
) -> None:
    await creds_svc.delete_credential(db, ctx, credential_id)
    await db.commit()
