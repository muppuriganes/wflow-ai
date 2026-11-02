"""Abstract base interface for commercial billing providers."""

import uuid
from abc import ABC, abstractmethod
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession


class BillingProvider(ABC):
    @abstractmethod
    async def create_checkout_session(
        self,
        db: AsyncSession,
        org_id: uuid.UUID,
        user_email: str,
        plan_key: str,
        return_url: str,
        interval: str = "monthly",
    ) -> str:
        """Creates a checkout session and returns the redirect URL."""

    @abstractmethod
    async def create_customer_portal_session(
        self,
        db: AsyncSession,
        org_id: uuid.UUID,
        return_url: str,
    ) -> str:
        """Creates a customer billing portal session and returns the redirect URL."""

    @abstractmethod
    def verify_webhook_signature(self, payload_bytes: bytes, signature_header: str) -> dict[str, Any]:
        """Validates incoming webhook signature header and parses the event payload."""

    @abstractmethod
    async def process_webhook_event(self, db: AsyncSession, event_dict: dict[str, Any]) -> None:
        """Idempotently handles a verified provider event."""
