import ipaddress
import socket
from urllib.parse import urlparse

from app.core.errors import AppError


class SSRFProtectionError(AppError):
    status_code = 422
    code = "ssrf_blocked"


# Internal stack ports that must never be targeted by outbound HTTP steps
BLOCKED_PORTS = {
    55432,  # PostgreSQL
    56379,  # Redis
    59000,  # MinIO API
    59001,  # MinIO Console
    51025,  # Mailpit SMTP
    58025,  # Mailpit Web UI
    57233,  # Temporal Frontend
    58233,  # Temporal Web UI
    8100,  # WFlow Backend API
    8200,  # WFlow Messaging Gateway
}


def validate_url_ssrf_safe(url: str, allow_localhost: bool = False) -> None:
    """Validates that a URL is safe to request from the server, preventing Server-Side Request Forgery.

    Checks:
    - Scheme must be http or https.
    - Port must not match internal services of this infrastructure stack.
    - Hostname must not resolve to loopback, private RFC 1918, link-local, multicast, or cloud metadata addresses.
    """
    if not url or not isinstance(url, str):
        raise SSRFProtectionError("A valid URL is required", code="invalid_url")

    try:
        parsed = urlparse(url.strip())
    except Exception as exc:
        raise SSRFProtectionError(f"Malformed URL: {exc}", code="invalid_url") from exc

    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise SSRFProtectionError(
            f"Invalid URL scheme '{scheme}'. Only http and https are allowed.",
            code="invalid_scheme",
        )

    hostname = parsed.hostname
    if not hostname:
        raise SSRFProtectionError("URL is missing a valid hostname", code="invalid_hostname")

    port = parsed.port or (443 if scheme == "https" else 80)
    if port in BLOCKED_PORTS:
        raise SSRFProtectionError(
            f"Port {port} is reserved for internal services and cannot be targeted.",
            code="blocked_port",
        )

    # Resolve hostname to IP addresses
    try:
        addr_info = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise SSRFProtectionError(
            f"Cannot resolve hostname '{hostname}': {exc.strerror}", code="dns_resolution_failed"
        ) from exc

    if not addr_info:
        raise SSRFProtectionError(f"Could not resolve any IP for hostname '{hostname}'", code="dns_empty")

    for item in addr_info:
        sockaddr = item[4]
        ip_str = sockaddr[0]

        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError as exc:
            raise SSRFProtectionError(f"Invalid resolved IP '{ip_str}'", code="invalid_ip") from exc

        # In testing environments, allow_localhost can bypass loopback if explicitly permitted
        if allow_localhost and (ip.is_loopback or ip_str == "127.0.0.1"):
            continue

        # Reject loopback (127.0.0.0/8, ::1)
        if ip.is_loopback:
            raise SSRFProtectionError(
                f"URL resolves to loopback address '{ip_str}'. Requests to localhost are blocked.",
                code="ssrf_loopback_blocked",
            )

        # Reject RFC 1918 private addresses (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7)
        if ip.is_private:
            raise SSRFProtectionError(
                f"URL resolves to private network address '{ip_str}'. Private network access is blocked.",
                code="ssrf_private_blocked",
            )

        # Reject link-local addresses (169.254.0.0/16, fe80::/10) - includes AWS/GCP/Azure metadata 169.254.169.254
        if ip.is_link_local:
            raise SSRFProtectionError(
                f"URL resolves to link-local address '{ip_str}'. Cloud metadata and link-local access is blocked.",
                code="ssrf_link_local_blocked",
            )

        # Reject multicast (224.0.0.0/4, ff00::/8)
        if ip.is_multicast:
            raise SSRFProtectionError(
                f"URL resolves to multicast address '{ip_str}'. Multicast access is blocked.",
                code="ssrf_multicast_blocked",
            )

        # Reject reserved / unspecified
        if ip.is_reserved or ip.is_unspecified:
            raise SSRFProtectionError(
                f"URL resolves to reserved address '{ip_str}'. Access is blocked.",
                code="ssrf_reserved_blocked",
            )
