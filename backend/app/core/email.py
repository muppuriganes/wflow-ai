"""Outgoing email. SMTP in all environments (Mailpit locally); tests swap in an in-memory sender."""

from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Protocol

import aiosmtplib

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)


@dataclass
class OutgoingEmail:
    to: str
    subject: str
    text: str


class EmailSender(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class SMTPEmailSender:
    async def send(self, email: OutgoingEmail) -> None:
        settings = get_settings()
        message = EmailMessage()
        message["From"] = settings.email_from
        message["To"] = email.to
        message["Subject"] = email.subject
        message.set_content(email.text)
        await aiosmtplib.send(
            message,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_username or None,
            password=settings.smtp_password or None,
            start_tls=settings.smtp_use_tls,
            timeout=15,
            # Without this aiosmtplib calls socket.getfqdn() for EHLO on every send (≈1s on Windows).
            local_hostname=settings.smtp_local_hostname,
        )


@dataclass
class MemoryEmailSender:
    outbox: list[OutgoingEmail] = field(default_factory=list)

    async def send(self, email: OutgoingEmail) -> None:
        self.outbox.append(email)


_sender: EmailSender = SMTPEmailSender()


def get_email_sender() -> EmailSender:
    return _sender


def set_email_sender(sender: EmailSender) -> None:
    global _sender
    _sender = sender


async def send_email_safely(email: OutgoingEmail) -> bool:
    """Email failures are logged, not raised: a flaky SMTP server must not fail a signup.
    Users can always request the message again (resend verification / forgot password)."""
    try:
        await get_email_sender().send(email)
        return True
    except Exception:
        log.exception("email_send_failed", subject=email.subject)
        return False
