"""S3-compatible object storage (MinIO locally). All keys start with the organization id."""

import asyncio
import uuid
from functools import lru_cache
from typing import Any, Protocol
from urllib.parse import quote

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger

log = get_logger(__name__)


class StorageUnavailableError(AppError):
    status_code = 503
    code = "storage_unavailable"


class Storage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...
    def url(self, key: str, *, file_name: str, internal: bool = False, expires: int = 300) -> str: ...


def attachment_key(organization_id: uuid.UUID, file_name: str) -> str:
    return f"{organization_id}/attachments/{uuid.uuid4().hex}/{file_name}"


@lru_cache(maxsize=2)
def _client(endpoint: str) -> Any:
    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=s.s3_access_key,
        aws_secret_access_key=s.s3_secret_key,
        region_name=s.s3_region,
        config=Config(
            signature_version="s3v4", s3={"addressing_style": "path"}, connect_timeout=5, read_timeout=30
        ),
    )


class S3Storage:
    def __init__(self) -> None:
        s = get_settings()
        self.bucket = s.s3_bucket
        self.internal_endpoint = s.s3_endpoint_url
        self.public_endpoint = s.s3_public_endpoint_url or s.s3_endpoint_url

    async def _run(self, fn: Any, **kwargs: Any) -> Any:
        try:
            return await asyncio.to_thread(fn, Bucket=self.bucket, **kwargs)
        except (BotoCoreError, ClientError) as exc:
            log.error("storage_error", operation=getattr(fn, "__name__", "?"), error=str(exc)[:300])
            raise StorageUnavailableError("File storage is temporarily unavailable") from exc

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await self._run(
            _client(self.internal_endpoint).put_object, Key=key, Body=data, ContentType=content_type
        )

    async def get(self, key: str) -> bytes:
        obj = await self._run(_client(self.internal_endpoint).get_object, Key=key)
        return await asyncio.to_thread(obj["Body"].read)  # type: ignore[no-any-return]

    async def delete(self, key: str) -> None:
        await self._run(_client(self.internal_endpoint).delete_object, Key=key)

    def url(self, key: str, *, file_name: str, internal: bool = False, expires: int = 300) -> str:
        """Short-lived signed URL. `internal` URLs are for the gateway; others for browsers."""
        endpoint = self.internal_endpoint if internal else self.public_endpoint
        return str(
            _client(endpoint).generate_presigned_url(
                "get_object",
                Params={
                    "Bucket": self.bucket,
                    "Key": key,
                    "ResponseContentDisposition": f"inline; filename*=UTF-8''{quote(file_name)}",
                },
                ExpiresIn=expires,
            )
        )


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        _storage = S3Storage()
    return _storage


def set_storage(storage: Storage | None) -> None:
    global _storage
    _storage = storage
