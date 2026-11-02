"""Per-request metadata (request id, client IP, user agent) available to services without
threading it through every call."""

from contextvars import ContextVar
from dataclasses import dataclass


@dataclass(frozen=True)
class RequestMeta:
    request_id: str | None = None
    ip_address: str | None = None
    user_agent: str | None = None


_current: ContextVar[RequestMeta] = ContextVar("request_meta", default=RequestMeta())  # noqa: B039 (frozen)


def set_request_meta(meta: RequestMeta) -> None:
    _current.set(meta)


def get_request_meta() -> RequestMeta:
    return _current.get()
