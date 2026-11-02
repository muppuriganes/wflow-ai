import uuid
from dataclasses import dataclass, field
from typing import Any

from app.core.errors import AppError
from app.services.gateway import GatewayUnavailableError, SendResult


@dataclass
class MemoryStorage:
    objects: dict[str, tuple[bytes, str]] = field(default_factory=dict)

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def get(self, key: str) -> bytes:
        return self.objects[key][0]

    async def delete(self, key: str) -> None:
        self.objects.pop(key, None)

    def url(self, key: str, *, file_name: str, internal: bool = False, expires: int = 300) -> str:
        host = "internal-storage" if internal else "files.example.com"
        return f"https://{host}/{key}?expires={expires}"


# Smallest valid PNG header + IHDR, enough for content sniffing.
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


class FakeGateway:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.fail_send: AppError | None = None
        self.unavailable = False
        self.fresh_flags: list[bool] = []

    def _check(self) -> None:
        if self.unavailable:
            raise GatewayUnavailableError("down")

    async def start(
        self, connection_id: uuid.UUID, organization_id: uuid.UUID, channel_type: str, fresh: bool
    ) -> None:
        self._check()
        self.calls.append(("start", connection_id))
        self.fresh_flags.append(fresh)

    async def stop(self, connection_id: uuid.UUID) -> None:
        self.calls.append(("stop", connection_id))

    async def logout(self, connection_id: uuid.UUID) -> None:
        self._check()
        self.calls.append(("logout", connection_id))

    async def remove(self, connection_id: uuid.UUID, organization_id: uuid.UUID) -> None:
        self._check()
        self.calls.append(("remove", connection_id))

    async def send_text(
        self,
        connection_id: uuid.UUID,
        organization_id: uuid.UUID,
        chat_id: str,
        text: str,
        client_message_id: str,
    ) -> SendResult:
        self.calls.append(("send", (chat_id, text, client_message_id)))
        if self.fail_send:
            raise self.fail_send
        return SendResult(provider_message_id=f"true_{chat_id}_{client_message_id}")

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
        self.calls.append(("send_media", (chat_id, media_url, file_name, content_type, caption)))
        if self.fail_send:
            raise self.fail_send
        return SendResult(provider_message_id=f"true_{chat_id}_{client_message_id}")

    async def simulate(self, connection_id: uuid.UUID, action: str, payload: dict[str, Any]) -> None:
        self.calls.append((f"simulate:{action}", payload))
