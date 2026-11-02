"""Outbound HTTP to customer-supplied URLs (webhooks, HTTP request steps) without SSRF.

Two layers:
- `check_url` validates a URL when it is saved or used: http(s) only, no internal ports, and every
  address the host resolves to must be public.
- `safe_client` makes requests whose connections are checked again at connect time, against the IP
  actually dialled. A hostname that resolved to a public address during `check_url` and to an
  internal one a moment later (DNS rebinding) is refused. TLS still verifies the real hostname.
Redirects are never followed.
"""

import asyncio
import ipaddress
import socket
from typing import Any
from urllib.parse import urlparse

import httpcore
import httpx

from app.core.config import get_settings
from app.core.errors import AppError


class SSRFProtectionError(AppError):
    status_code = 422
    code = "ssrf_blocked"


# Internal stack ports that must never be targeted by outbound requests
BLOCKED_PORTS = {
    5432, 6379, 7233, 8000, 8233, 9000, 9001,  # inside the production compose network
    55432, 56379, 59000, 59001, 51025, 58025, 57233, 58233, 8100, 8200,  # local development ports
}  # fmt: skip

MAX_RESPONSE_BYTES = 256 * 1024


def check_ip(ip_str: str) -> None:
    """Only globally routable unicast addresses are allowed (no loopback, private, link-local and
    cloud metadata, carrier-grade NAT, documentation, multicast or reserved ranges)."""
    try:
        ip = ipaddress.ip_address(ip_str.split("%", 1)[0])
    except ValueError as exc:
        raise SSRFProtectionError(f"Invalid address '{ip_str}'", code="invalid_ip") from exc
    if isinstance(ip, ipaddress.IPv6Address):
        embedded = ip.ipv4_mapped or ip.sixtofour or (ip.teredo[1] if ip.teredo else None)
        if embedded is not None:
            ip = embedded
    if ip.is_multicast or ip.is_reserved or ip.is_unspecified:
        raise SSRFProtectionError(f"The address {ip_str} is reserved", code="ssrf_blocked")
    # Development may call this machine or the LAN; link-local (cloud metadata) never.
    dev_ok = (
        get_settings().outbound_allow_private_networks
        and (ip.is_loopback or ip.is_private)
        and not ip.is_link_local
    )
    if not ip.is_global and not dev_ok:
        raise SSRFProtectionError(
            f"The address {ip_str} is internal or reserved. Only public internet addresses can be called.",
            code="ssrf_blocked",
        )


def _parse(url: str) -> tuple[str, int]:
    if not url or not isinstance(url, str):
        raise SSRFProtectionError("A valid URL is required", code="invalid_url")
    try:
        parsed = urlparse(url.strip())
        port = parsed.port
    except ValueError as exc:
        raise SSRFProtectionError(f"Malformed URL: {exc}", code="invalid_url") from exc
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise SSRFProtectionError("Only http and https URLs are allowed", code="invalid_scheme")
    if not parsed.hostname:
        raise SSRFProtectionError("The URL has no host name", code="invalid_hostname")
    if parsed.username or parsed.password:
        raise SSRFProtectionError("Put credentials in a saved credential, not in the URL", code="invalid_url")
    port = port or (443 if scheme == "https" else 80)
    if port in BLOCKED_PORTS:
        raise SSRFProtectionError(f"Port {port} is reserved for internal services", code="blocked_port")
    return parsed.hostname, port


async def _resolve(host: str, port: int) -> list[str]:
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFProtectionError(f"Cannot resolve '{host}'", code="dns_resolution_failed") from exc
    ips = list(dict.fromkeys(str(info[4][0]) for info in infos))
    if not ips:
        raise SSRFProtectionError(f"'{host}' has no address", code="dns_empty")
    for ip in ips:
        check_ip(ip)
    return ips


async def check_url(url: str) -> None:
    """Raises SSRFProtectionError unless the URL is safe to call right now."""
    host, port = _parse(url)
    await _resolve(host, port)


class _GuardedBackend(httpcore.AsyncNetworkBackend):
    """Resolves and checks the host at connect time, then dials the checked IP itself."""

    def __init__(self) -> None:
        self._inner = httpcore.AnyIOBackend()

    async def connect_tcp(self, host: str, port: int, timeout: float | None = None,  # noqa: ASYNC109 (httpcore API)
                          local_address: str | None = None, socket_options: Any = None) -> httpcore.AsyncNetworkStream:  # fmt: skip
        if port in BLOCKED_PORTS:
            raise SSRFProtectionError(f"Port {port} is reserved for internal services", code="blocked_port")
        ips = await _resolve(host, port)
        return await self._inner.connect_tcp(ips[0], port, timeout=timeout, local_address=local_address,
                                             socket_options=socket_options)  # fmt: skip

    async def connect_unix_socket(self, *args: Any, **kwargs: Any) -> httpcore.AsyncNetworkStream:
        raise SSRFProtectionError("Unix sockets are not allowed", code="ssrf_blocked")

    async def sleep(self, seconds: float) -> None:
        await self._inner.sleep(seconds)


def safe_client(timeout: float) -> httpx.AsyncClient:
    """An httpx client for customer-supplied URLs: guarded connections, no redirects, no proxies
    from the environment."""
    transport = httpx.AsyncHTTPTransport()
    # httpx does not expose the network backend; swap in a pool that uses the guarded one.
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=transport._pool._ssl_context, network_backend=_GuardedBackend()
    )
    return httpx.AsyncClient(transport=transport, timeout=timeout, follow_redirects=False, trust_env=False)


async def read_limited(response: httpx.Response, limit: int = MAX_RESPONSE_BYTES) -> tuple[str, bool]:
    """Reads at most `limit` bytes of a streamed response. Returns (text, truncated)."""
    chunks: list[bytes] = []
    size = 0
    truncated = False
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        size += len(chunk)
        if size >= limit:
            truncated = True
            break
    body = b"".join(chunks)[:limit]
    return body.decode(response.encoding or "utf-8", errors="replace"), truncated


def validate_url_ssrf_safe(url: str, allow_localhost: bool = False) -> None:
    """Kept for callers that only need the format checks (scheme, host, port, literal IPs)."""
    host, _port = _parse(url)
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return
    if not allow_localhost:
        check_ip(host.strip("[]"))
