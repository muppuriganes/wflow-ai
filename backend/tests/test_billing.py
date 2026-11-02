"""Tests for Billing foundation: Stripe test mode provider, webhooks, signature verification, and idempotency."""

import hashlib
import hmac
import json
import time
import uuid

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from tests.conftest import register


def generate_stripe_signature(payload_str: str, secret: str | None = None) -> str:
    sec = secret or get_settings().stripe_webhook_secret or "whsec_test_secret"
    ts = int(time.time())
    data = f"{ts}.{payload_str}".encode()
    sig = hmac.new(sec.encode("utf-8"), data, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


@pytest.mark.asyncio
async def test_billing_checkout_and_portal(client: AsyncClient, make_client: object) -> None:
    """Test-mode checkout: the signed session from checkout upgrades the plan once it is redeemed."""
    from urllib.parse import parse_qs, urlparse

    a = await register(client, email="billing_owner@example.com")
    base = f"/api/v1/organizations/{a.org_id}/billing"
    app_url = get_settings().cors_origin_list[0] + "/billing"

    evil = await client.post(f"{base}/checkout", headers=a.headers,
                             json={"plan_key": "business", "return_url": "https://evil.example/phish"})  # fmt: skip
    assert evil.status_code == 400 and evil.json()["error"]["code"] == "invalid_return_url"

    res = await client.post(f"{base}/checkout", headers=a.headers,
                            json={"plan_key": "business", "billing_interval": "yearly", "return_url": app_url})  # fmt: skip
    assert res.status_code == 200, res.text
    url = res.json()["checkout_url"]
    assert url.startswith(app_url)
    session = parse_qs(urlparse(url).query)["checkout_session"][0]

    # A forged or tampered session is refused, and so is one issued to another organization.
    forged = session.replace("business", "growth")
    assert (await client.post(f"{base}/checkout/confirm", headers=a.headers,
                              json={"session_id": forged})).status_code == 400  # fmt: skip
    other_client: AsyncClient = make_client()  # type: ignore[operator]
    b = await register(other_client, email="billing_other@example.com", org_name="Other Billing")
    stolen = await other_client.post(f"/api/v1/organizations/{b.org_id}/billing/checkout/confirm",
                                     headers=b.headers, json={"session_id": session})  # fmt: skip
    assert stolen.status_code == 400
    await other_client.aclose()

    done = await client.post(f"{base}/checkout/confirm", headers=a.headers, json={"session_id": session})
    assert done.status_code == 200, done.text
    assert done.json()["plan_key"] == "business" and done.json()["billing_interval"] == "yearly"
    assert done.json()["status"] == "active" and done.json()["trial_end"] is None  # paying ends the trial
    again = await client.post(f"{base}/checkout/confirm", headers=a.headers, json={"session_id": session})
    assert again.status_code == 200  # reloading the page is harmless
    invoices = (await client.get(f"{base}/invoices", headers=a.headers)).json()
    assert len(invoices) == 1 and invoices[0]["amount_cents"] == 199000

    portal = await client.post(f"{base}/portal", headers=a.headers, json={"return_url": app_url})
    assert portal.status_code == 200 and "bps_test_" in portal.json()["portal_url"]


def test_production_refuses_public_default_secrets() -> None:
    from pydantic import ValidationError

    from app.core.config import Settings

    good = {
        "environment": "production", "jwt_secret": "x" * 40, "cookie_secure": True, "internal_api_token": "y" * 40,
        "simulator_enabled": False, "workflow_time_scale": 1.0, "credentials_encryption_key": "k" * 40,
        "stripe_webhook_secret": "whsec_real_secret", "billing_test_mode": False,
    }  # fmt: skip
    Settings(**good)  # type: ignore[arg-type]
    for field, bad in (("credentials_encryption_key", "wflow-credentials-encryption-key-32b!"),
                       ("stripe_webhook_secret", "whsec_mock_wflow"), ("billing_test_mode", True)):  # fmt: skip
        with pytest.raises(ValidationError, match=field.upper()):
            Settings(**{**good, field: bad})  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_billing_cancel_and_resume(client: AsyncClient) -> None:
    a = await register(client, email="cancel_resume@example.com")
    org_id = a.org_id
    headers = a.headers

    # Cancel at period end
    res = await client.post(f"/api/v1/organizations/{org_id}/billing/cancel", headers=headers)
    assert res.status_code == 200
    assert res.json()["cancel_at_period_end"] is True

    # Resume
    res = await client.post(f"/api/v1/organizations/{org_id}/billing/resume", headers=headers)
    assert res.status_code == 200
    assert res.json()["cancel_at_period_end"] is False


@pytest.mark.asyncio
async def test_stripe_webhook_signature_verification(client: AsyncClient) -> None:
    payload = json.dumps({"id": "evt_test_sig", "type": "ping"})

    # 1. Missing signature header -> 401
    res = await client.post("/api/v1/billing/webhook/stripe", content=payload)
    assert res.status_code == 401

    # 2. Invalid signature -> 401
    res = await client.post(
        "/api/v1/billing/webhook/stripe",
        content=payload,
        headers={"Stripe-Signature": "t=123456,v1=bad_signature"},
    )
    assert res.status_code == 401

    # 3. Valid signature -> 200
    valid_sig = generate_stripe_signature(payload)
    res = await client.post(
        "/api/v1/billing/webhook/stripe",
        content=payload,
        headers={"Stripe-Signature": valid_sig},
    )
    assert res.status_code == 200
    assert res.json() == {"received": True}


@pytest.mark.asyncio
async def test_stripe_webhook_idempotent_event_processing(client: AsyncClient) -> None:
    a = await register(client, email="webhook_idempotency@example.com")
    org_id = a.org_id
    headers = a.headers

    # 1. Simulate checkout.session.completed
    checkout_event = {
        "id": f"evt_checkout_{uuid.uuid4().hex[:12]}",
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "client_reference_id": org_id,
                "customer": "cus_test_12345",
                "subscription": "sub_test_12345",
                "metadata": {"plan_key": "business"},
            }
        },
    }
    body = json.dumps(checkout_event)
    sig = generate_stripe_signature(body)

    # First delivery
    res = await client.post("/api/v1/billing/webhook/stripe", content=body, headers={"Stripe-Signature": sig})
    assert res.status_code == 200

    # Verify subscription was activated and updated to business
    res_usage = await client.get(f"/api/v1/organizations/{org_id}/plans/usage", headers=headers)
    assert res_usage.status_code == 200
    assert res_usage.json()["subscription"]["plan_key"] == "business"
    assert res_usage.json()["subscription"]["status"] == "active"

    # Re-send same checkout event (idempotency check)
    res_dupe = await client.post(
        "/api/v1/billing/webhook/stripe", content=body, headers={"Stripe-Signature": sig}
    )
    assert res_dupe.status_code == 200

    # 2. Simulate invoice.paid
    invoice_event = {
        "id": f"evt_inv_{uuid.uuid4().hex[:12]}",
        "type": "invoice.paid",
        "data": {
            "object": {
                "id": "in_test_9999",
                "number": "INV-TEST-0001",
                "customer": "cus_test_12345",
                "subscription": "sub_test_12345",
                "amount_paid": 19900,
                "currency": "usd",
                "hosted_invoice_url": "https://stripe.com/test_invoice.pdf",
            }
        },
    }
    inv_body = json.dumps(invoice_event)
    inv_sig = generate_stripe_signature(inv_body)

    # First delivery of invoice.paid
    res_inv = await client.post(
        "/api/v1/billing/webhook/stripe", content=inv_body, headers={"Stripe-Signature": inv_sig}
    )
    assert res_inv.status_code == 200

    # Verify invoice appears in org's invoices list
    res_invoices = await client.get(f"/api/v1/organizations/{org_id}/billing/invoices", headers=headers)
    assert res_invoices.status_code == 200
    inv_items = res_invoices.json()
    assert len(inv_items) == 1
    assert inv_items[0]["invoice_number"] == "INV-TEST-0001"
    assert inv_items[0]["amount_cents"] == 19900

    # Re-send same invoice.paid event (idempotency: should NOT create duplicate row)
    res_inv_dupe = await client.post(
        "/api/v1/billing/webhook/stripe", content=inv_body, headers={"Stripe-Signature": inv_sig}
    )
    assert res_inv_dupe.status_code == 200

    res_invoices_after = await client.get(f"/api/v1/organizations/{org_id}/billing/invoices", headers=headers)
    assert len(res_invoices_after.json()) == 1

    # 3. Tenant isolation: org B cannot see org A's invoices
    b = await register(client, email="other_invoices@example.com")
    res_b_inv = await client.get(f"/api/v1/organizations/{b.org_id}/billing/invoices", headers=b.headers)
    assert res_b_inv.status_code == 200
    assert len(res_b_inv.json()) == 0

    # 4. Simulate customer.subscription.deleted
    sub_del_event = {
        "id": f"evt_del_{uuid.uuid4().hex[:12]}",
        "type": "customer.subscription.deleted",
        "data": {
            "object": {
                "id": "sub_test_12345",
            }
        },
    }
    del_body = json.dumps(sub_del_event)
    del_sig = generate_stripe_signature(del_body)

    res_del = await client.post(
        "/api/v1/billing/webhook/stripe", content=del_body, headers={"Stripe-Signature": del_sig}
    )
    assert res_del.status_code == 200

    # Verify downgraded to free and status canceled
    res_usage_after = await client.get(f"/api/v1/organizations/{org_id}/plans/usage", headers=headers)
    assert res_usage_after.json()["subscription"]["plan_key"] == "free"
    assert res_usage_after.json()["subscription"]["status"] == "canceled"
