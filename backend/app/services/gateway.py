"""Client for the messaging gateway's internal API.

The gateway is the only component that holds channel sessions. Commands go backend -> gateway
over HTTP with a shared internal token; results and lifecycle updates come back as events on a
Redis stream (see app/workers/channel_events.py).
"""

import uuid
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger(__name__)


class GatewayUnavailableError(AppError):
    status_code = 503
    code = "gateway_unavailable"


@dataclass
class SendResult:
    provider_message_id: str


class Gateway(Protocol):
    async def start(
        self, connection_id: uuid.UUID, organization_id: uuid.UUID, channel_type: str, fresh: bool
    ) -> None: ...
    async def stop(self, connection_id: uuid.UUID) -> None: ...
    async def logout(self, connection_id: uuid.UUID) -> None: ...
    async def remove(self, connection_id: uuid.UUID, organization_id: uuid.UUID) -> None: ...
    async def send_text(
        self,
        connection_id: uuid.UUID,
        organization_id: uuid.UUID,
        chat_id: str,
        text: str,
        client_message_id: str,
    ) -> SendResult: ...
    async def send_media(
        self,
        connection_id: uuid.UUID,
        organization_id: uuid.UUID,
        chat_id: str,
        *,
        media_url: str,
        file_name: str,
        content_type: str,
        caption: str | None,
        client_message_id: str,
    ) -> SendResult: ...
    async def simulate(self, connection_id: uuid.UUID, action: str, payload: dict[str, Any]) -> None: ...


class HTTPGateway:
    def __init__(self, base_url: str, token: str, timeout: float = 30.0) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url, timeout=timeout, headers={"Authorization": f"Bearer {token}"}
        )

    async def _call(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        try:
            res = await self._client.request(method, path, json=json)
        except httpx.HTTPError as exc:
            log.error("gateway_unreachable", path=path, error=str(exc))
            raise GatewayUnavailableError(
                "The messaging service is not reachable. Try again in a moment."
            ) from exc
        body: dict[str, Any] = res.json() if res.content else {}
        if res.status_code >= 400:
            error = body.get("error", {})
            raise AppError(
                error.get("message", "Messaging service error"),
                code=error.get("code", "gateway_error"),
            )
        return body

    async def start(
        self, connection_id: uuid.UUID, organization_id: uuid.UUID, channel_type: str, fresh: bool
    ) -> None:
        await self._call(
            "POST",
            f"/v1/connections/{connection_id}/start",
            {"organization_id": str(organization_id), "channel_type": channel_type, "fresh": fresh},
        )

    async def stop(self, connection_id: uuid.UUID) -> None:
        await self._call("POST", f"/v1/connections/{connection_id}/stop")

    async def logout(self, connection_id: uuid.UUID) -> None:
        await self._call("POST", f"/v1/connections/{connection_id}/logout")

    async def remove(self, connection_id: uuid.UUID, organization_id: uuid.UUID) -> None:
        await self._call(
            "POST", f"/v1/connections/{connection_id}/remove", {"organization_id": str(organization_id)}
        )

    async def send_text(
        self,
        connection_id: uuid.UUID,
        organization_id: uuid.UUID,
        chat_id: str,
        text: str,
        client_message_id: str,
    ) -> SendResult:
        body = await self._call(
            "POST",
            f"/v1/connections/{connection_id}/messages",
            {
                "organization_id": str(organization_id),
                "chat_id": chat_id,
                "text": text,
                "client_message_id": client_message_id,
            },
        )
        return SendResult(provider_message_id=str(body["provider_message_id"]))

    async def send_media(
        self,
        connection_id: uuid.UUID,
        organization_id: uuid.UUID,
        chat_id: str,
        *,
        media_url: str,
        file_name: str,
        content_type: str,
        caption: str | None,
        client_message_id: str,
    ) -> SendResult:
        """The gateway downloads the file from a short-lived signed URL (no storage credentials)."""
        body = await self._call(
            "POST",
            f"/v1/connections/{connection_id}/media",
            {
                "organization_id": str(organization_id),
                "chat_id": chat_id,
                "media_url": media_url,
                "file_name": file_name,
                "content_type": content_type,
                "caption": caption,
                "client_message_id": client_message_id,
            },
        )
        return SendResult(provider_message_id=str(body["provider_message_id"]))

    async def simulate(self, connection_id: uuid.UUID, action: str, payload: dict[str, Any]) -> None:
        await self._call("POST", f"/v1/simulator/{connection_id}/{action}", payload)

    async def aclose(self) -> None:
        await self._client.aclose()


_gateway: Gateway | None = None


def get_gateway() -> Gateway:
    global _gateway
    if _gateway is None:
        settings = get_settings()
        _gateway = HTTPGateway(settings.gateway_url, settings.internal_api_token)
    return _gateway


def set_gateway(gateway: Gateway | None) -> None:
    """Tests swap in a fake gateway."""
    global _gateway
    _gateway = gateway
