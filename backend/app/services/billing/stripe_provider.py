"""Stripe Test Mode billing provider with signature verification and idempotent event handling."""

import hashlib
import hmac
import json
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthenticationError
from app.core.logging import get_logger
from app.database.session import set_rls_context
from app.models.commercial import InvoiceRecord, ProcessedProviderEvent, Subscription
from app.services.billing.provider import BillingProvider
from app.services.plans import get_or_create_subscription, get_plan_by_key

log = get_logger("billing.stripe")


TEST_CHECKOUT_TTL_SECONDS = 1800


def sign_test_checkout(org_id: uuid.UUID, plan_key: str, interval: str = "monthly") -> str:
    body = f"{org_id}:{plan_key}:{interval}:{int(time.time()) + TEST_CHECKOUT_TTL_SECONDS}"
    sig = hmac.new(get_settings().jwt_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"cs_test.{body}.{sig}"


def read_test_checkout(session_id: str, org_id: uuid.UUID) -> tuple[str, str] | None:
    """Returns (plan key, interval) if the token is genuine, unexpired and for this organization."""
    try:
        _prefix, body, sig = session_id.split(".")
        token_org, plan_key, interval, expires = body.split(":")
    except ValueError:
        return None
    expected = hmac.new(get_settings().jwt_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected) or token_org != str(org_id) or int(expires) < time.time():
        return None
    return plan_key, interval


class StripeTestBillingProvider(BillingProvider):
    """Stripe billing provider operating strictly in Test Mode (never touches real money)."""

    def __init__(self) -> None:
        self.settings = get_settings()

    async def create_checkout_session(
        self,
        db: AsyncSession,
        org_id: uuid.UUID,
        user_email: str,
        plan_key: str,
        return_url: str,
        interval: str = "monthly",
    ) -> str:
        """Test mode: no payment page exists, so the session id is a signed, short-lived token that
        the Billing page redeems (see billing_service.confirm_test_checkout)."""
        plan = await get_plan_by_key(db, plan_key)
        session_id = sign_test_checkout(org_id, plan.key, interval)
        log.info("stripe_test_checkout_created", org_id=str(org_id), plan=plan.key)
        sep = "&" if "?" in return_url else "?"
        return f"{return_url}{sep}checkout_session={session_id}"

    async def create_customer_portal_session(
        self,
        db: AsyncSession,
        org_id: uuid.UUID,
        return_url: str,
    ) -> str:
        """Generates a test portal URL."""
        session_id = f"bps_test_{uuid.uuid4().hex[:24]}"
        log.info("stripe_test_portal_created", org_id=str(org_id), session_id=session_id)
        sep = "&" if "?" in return_url else "?"
        return f"{return_url}{sep}portal_session={session_id}"

    def verify_webhook_signature(self, payload_bytes: bytes, signature_header: str) -> dict[str, Any]:
        """Validates incoming Stripe signature header (t=...,v1=...) via HMAC-SHA256."""
        secret = self.settings.stripe_webhook_secret

        items = {}
        for part in signature_header.split(","):
            kv = part.strip().split("=", 1)
            if len(kv) == 2:
                items[kv[0]] = kv[1]

        timestamp = items.get("t")
        sig = items.get("v1")
        if not timestamp or not sig:
            raise AuthenticationError("Invalid Stripe signature header format")

        # In test mode, tolerate timestamps up to 1 hour
        try:
            ts_int = int(timestamp)
            if abs(time.time() - ts_int) > 3600:
                raise AuthenticationError("Stripe webhook timestamp too old")
        except ValueError as exc:
            raise AuthenticationError("Invalid timestamp in Stripe signature") from exc

        payload_str = payload_bytes.decode("utf-8")
        data_to_sign = f"{timestamp}.{payload_str}".encode()
        expected_sig = hmac.new(secret.encode("utf-8"), data_to_sign, hashlib.sha256).hexdigest()

        if not hmac.compare_digest(sig, expected_sig):
            raise AuthenticationError("Stripe webhook signature verification failed")

        try:
            return json.loads(payload_str)
        except Exception as exc:
            raise AuthenticationError(f"Malformed Stripe event JSON: {exc}") from exc

    async def process_webhook_event(self, db: AsyncSession, event_dict: dict[str, Any]) -> None:
        """Idempotently handles Stripe webhook events."""
        event_id = event_dict.get("id")
        event_type = event_dict.get("type")
        if not event_id or not event_type:
            log.warning("stripe_event_missing_fields", event_keys=sorted(event_dict))
            return

        # Deduplication check
        existing = await db.scalar(
            select(ProcessedProviderEvent).where(
                ProcessedProviderEvent.provider == "stripe",
                ProcessedProviderEvent.event_id == event_id,
            )
        )
        if existing is not None:
            log.info("stripe_event_already_processed", event_id=event_id, event_type=event_type)
            return

        db.add(ProcessedProviderEvent(provider="stripe", event_id=event_id))
        await db.flush()

        data_obj = event_dict.get("data", {}).get("object", {})

        if event_type == "checkout.session.completed":
            org_id_raw = data_obj.get("client_reference_id") or data_obj.get("metadata", {}).get(
                "organization_id"
            )
            if org_id_raw:
                org_id = uuid.UUID(str(org_id_raw))
                await set_rls_context(db, user_id=None, org_id=org_id)
                sub = await get_or_create_subscription(db, org_id)
                plan_key = data_obj.get("metadata", {}).get("plan_key")
                if plan_key:
                    plan = await get_plan_by_key(db, plan_key)
                    sub.plan_id = plan.id
                    sub.plan = plan

                sub.status = "active"
                sub.trial_end = None
                sub.provider_customer_id = data_obj.get("customer")
                sub.provider_subscription_id = data_obj.get("subscription")
                sub.cancel_at_period_end = False

        elif event_type == "invoice.paid":
            sub_id_str = data_obj.get("subscription")
            cust_id_str = data_obj.get("customer")
            res_org = await db.scalar(
                text("SELECT org_id_by_stripe_customer_or_sub(:cust, :sub)"),
                {"cust": cust_id_str, "sub": sub_id_str},
            )
            if res_org:
                await set_rls_context(db, user_id=None, org_id=res_org)
                sub = None
                if sub_id_str:
                    sub = await db.scalar(
                        select(Subscription).where(Subscription.provider_subscription_id == str(sub_id_str))
                    )
                if not sub and cust_id_str:
                    sub = await db.scalar(
                        select(Subscription).where(Subscription.provider_customer_id == str(cust_id_str))
                    )

                if sub:
                    inv_id = data_obj.get("id") or f"in_test_{uuid.uuid4().hex[:12]}"
                    inv_num = data_obj.get("number") or f"INV-{uuid.uuid4().hex[:8].upper()}"
                    amt = data_obj.get("amount_paid") or data_obj.get("total") or 0
                    curr = (data_obj.get("currency") or "usd").lower()
                    p_start = datetime.fromtimestamp(data_obj.get("period_start", int(time.time())), UTC)
                    p_end = datetime.fromtimestamp(
                        data_obj.get("period_end", int(time.time()) + 2592000), UTC
                    )

                    invoice = InvoiceRecord(
                        organization_id=sub.organization_id,
                        subscription_id=sub.id,
                        invoice_number=inv_num,
                        amount_cents=amt,
                        currency=curr,
                        status="paid",
                        period_start=p_start,
                        period_end=p_end,
                        pdf_url=data_obj.get("hosted_invoice_url") or data_obj.get("invoice_pdf"),
                        provider_invoice_id=inv_id,
                    )
                    db.add(invoice)

        elif event_type == "customer.subscription.deleted":
            sub_id_str = data_obj.get("id")
            cust_id_str = data_obj.get("customer")
            res_org = await db.scalar(
                text("SELECT org_id_by_stripe_customer_or_sub(:cust, :sub)"),
                {"cust": cust_id_str, "sub": sub_id_str},
            )
            if res_org:
                await set_rls_context(db, user_id=None, org_id=res_org)
                sub = await db.scalar(
                    select(Subscription).where(Subscription.provider_subscription_id == str(sub_id_str))
                )
                if sub:
                    sub.status = "canceled"
                    free_plan = await get_plan_by_key(db, "free")
                    sub.plan_id = free_plan.id
                    sub.plan = free_plan

        elif event_type == "customer.subscription.updated":
            sub_id_str = data_obj.get("id")
            cust_id_str = data_obj.get("customer")
            res_org = await db.scalar(
                text("SELECT org_id_by_stripe_customer_or_sub(:cust, :sub)"),
                {"cust": cust_id_str, "sub": sub_id_str},
            )
            if res_org:
                await set_rls_context(db, user_id=None, org_id=res_org)
                sub = await db.scalar(
                    select(Subscription).where(Subscription.provider_subscription_id == str(sub_id_str))
                )
                if sub:
                    if "cancel_at_period_end" in data_obj:
                        sub.cancel_at_period_end = data_obj["cancel_at_period_end"]
                    if "current_period_start" in data_obj:
                        sub.current_period_start = datetime.fromtimestamp(
                            data_obj["current_period_start"], UTC
                        )
                    if "current_period_end" in data_obj:
                        sub.current_period_end = datetime.fromtimestamp(data_obj["current_period_end"], UTC)
                    if data_obj.get("status"):
                        sub.status = data_obj["status"]

        await db.flush()
