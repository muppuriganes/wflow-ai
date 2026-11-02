"""Side effects performed by workflow steps. Each runs inside one activity transaction with the
run's organization as RLS context, and is idempotent where a retry could otherwise repeat it."""

import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.ssrf import validate_url_ssrf_safe
from app.models import (
    Contact,
    ContactTag,
    Conversation,
    ConversationAssignment,
    ConversationNote,
    CustomerActivity,
    FollowUpTask,
    Lead,
    OrganizationMember,
    Tag,
)
from app.services.messaging import deliver
from app.workflow_engine.expressions import render

logger = get_logger(__name__)


class StepSkipped(Exception):
    """The step could not apply (e.g. contact opted out) but the workflow should continue."""


async def _conversation(db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any]) -> Conversation:
    conv_id = (ctx.get("conversation") or {}).get("id")
    if not conv_id:
        raise StepSkipped("This run has no conversation")
    conv = await db.scalar(
        select(Conversation).where(
            Conversation.id == uuid.UUID(conv_id), Conversation.organization_id == org_id
        )
    )
    if conv is None:
        raise StepSkipped("The conversation no longer exists")
    return conv


def _contact_id(ctx: dict[str, Any]) -> uuid.UUID:
    contact_id = (ctx.get("contact") or {}).get("id")
    if not contact_id:
        raise StepSkipped("This run has no contact")
    return uuid.UUID(contact_id)


async def _member(db: AsyncSession, org_id: uuid.UUID, user_id: str | None) -> uuid.UUID | None:
    if not user_id:
        return None
    uid = uuid.UUID(user_id)
    exists = await db.scalar(
        select(OrganizationMember.id).where(
            OrganizationMember.organization_id == org_id,
            OrganizationMember.user_id == uid,
            OrganizationMember.status == "active",
        )
    )
    if not exists:
        raise StepSkipped("The selected team member is no longer in this organization")
    return uid


def client_message_id(run_id: str, node_id: str) -> str:
    """Deterministic idempotency key: an activity retry never sends a second message."""
    return ("wf" + uuid.UUID(run_id).hex + re.sub(r"[^A-Za-z0-9_-]", "", node_id))[:64]


async def send_message(db: AsyncSession, org_id: uuid.UUID, run_id: str, node_id: str,
                       ctx: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:  # fmt: skip
    conv = await _conversation(db, org_id, ctx)
    text = render(config["text"], ctx).strip()
    if not text:
        raise StepSkipped("The message was empty after filling in variables")
    try:
        msg = await deliver(db, org_id, conv, client_message_id(run_id, node_id), text,
                            sent_by_user_id=None, automated=True)  # fmt: skip
    except AppError as exc:
        # Governance refusals (opt-out, human takeover, not customer-initiated, channel down,
        # rate limit) are reported on the step; the workflow continues without sending.
        raise StepSkipped(exc.message) from exc
    if msg.status == "failed":
        raise StepSkipped(f"Not delivered: {msg.error}")
    return {"message_id": str(msg.id), "text": text, "status": msg.status}


async def add_tag(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    contact_id = _contact_id(ctx)
    tag = await db.scalar(
        select(Tag).where(Tag.id == uuid.UUID(config["tag_id"]), Tag.organization_id == org_id)
    )
    if tag is None:
        raise StepSkipped("The tag was deleted")
    await db.execute(
        insert(ContactTag)
        .values(contact_id=contact_id, tag_id=tag.id, organization_id=org_id)
        .on_conflict_do_nothing()
    )
    return {"tag": tag.name}


async def remove_tag(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    contact_id = _contact_id(ctx)
    await db.execute(
        delete(ContactTag).where(
            ContactTag.contact_id == contact_id, ContactTag.tag_id == uuid.UUID(config["tag_id"])
        )
    )
    return {"removed": config["tag_id"]}


async def _assign(db: AsyncSession, org_id: uuid.UUID, conv: Conversation, user_id: uuid.UUID | None) -> None:
    if user_id is None or conv.assigned_user_id == user_id:
        return
    conv.assigned_user_id = user_id
    if conv.status in ("OPEN", "PENDING"):
        conv.status = "ASSIGNED"
    db.add(ConversationAssignment(organization_id=org_id, conversation_id=conv.id, assigned_user_id=user_id,
                                  assigned_by_user_id=None, created_at=datetime.now(UTC)))  # fmt: skip


async def assign(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    conv = await _conversation(db, org_id, ctx)
    await _assign(db, org_id, conv, await _member(db, org_id, config["user_id"]))
    return {"assigned_user_id": config["user_id"]}


async def set_status(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    conv = await _conversation(db, org_id, ctx)
    status = config["status"]
    if status == "OPEN" and conv.assigned_user_id:
        status = "ASSIGNED"
    conv.status = status
    conv.resolved_at = datetime.now(UTC) if status == "RESOLVED" else None
    return {"status": status}


async def set_priority(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    conv = await _conversation(db, org_id, ctx)
    conv.priority = config["priority"]
    return {"priority": conv.priority}


async def add_note(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    conv = await _conversation(db, org_id, ctx)
    body = render(config["body"], ctx, 2000).strip() or "(empty note)"
    db.add(ConversationNote(organization_id=org_id, conversation_id=conv.id, author_user_id=None,
                            body=f"[Automation] {body}", created_at=datetime.now(UTC)))  # fmt: skip
    return {"note": body}


async def create_lead(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    contact_id = _contact_id(ctx)
    contact = await db.scalar(
        select(Contact).where(Contact.id == contact_id, Contact.organization_id == org_id)
    )
    if contact is None:
        raise StepSkipped("The contact no longer exists")
    now = datetime.now(UTC)
    title = render(config["title"], ctx, 200).strip() or "New lead"
    lead = Lead(
        id=uuid.uuid4(), organization_id=org_id, contact_id=contact_id, title=title,
        stage=config.get("stage", "NEW"), source="workflow",
        value_amount=Decimal(str(config["value"])) if config.get("value") is not None else None,
        owner_user_id=await _member(db, org_id, config.get("owner_user_id")), created_at=now, updated_at=now,
    )  # fmt: skip
    db.add(lead)
    await db.flush()
    db.add(CustomerActivity(organization_id=org_id, contact_id=contact_id, lead_id=lead.id, actor_user_id=None,
                            activity_type="lead.created", summary=f"Lead created by automation: {title}",
                            details={"stage": lead.stage}, created_at=now))  # fmt: skip
    return {"lead_id": str(lead.id), "title": title}


async def create_task(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    now = datetime.now(UTC)
    contact_raw = (ctx.get("contact") or {}).get("id")
    conv_raw = (ctx.get("conversation") or {}).get("id")
    hours = config.get("due_in_hours")
    task = FollowUpTask(
        id=uuid.uuid4(), organization_id=org_id, title=render(config["title"], ctx, 200).strip() or "Follow up",
        due_at=now + timedelta(hours=float(hours)) if hours is not None else None,
        assignee_user_id=await _member(db, org_id, config.get("assignee_user_id")),
        contact_id=uuid.UUID(contact_raw) if contact_raw else None,
        conversation_id=uuid.UUID(conv_raw) if conv_raw else None,
        created_by_user_id=None, created_at=now, updated_at=now,
    )  # fmt: skip
    db.add(task)
    return {
        "task_id": str(task.id),
        "title": task.title,
        "due_at": task.due_at.isoformat() if task.due_at else None,
    }


async def handover(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    conv = await _conversation(db, org_id, ctx)
    conv.automation_paused = True
    await _assign(db, org_id, conv, await _member(db, org_id, config.get("user_id")))
    if config.get("note"):
        db.add(ConversationNote(organization_id=org_id, conversation_id=conv.id, author_user_id=None,
                                body=f"[Automation] {render(config['note'], ctx, 500)}", created_at=datetime.now(UTC)))  # fmt: skip
    return {"automation_paused": True, "assigned_user_id": config.get("user_id")}


async def http_request(
    db: AsyncSession, org_id: uuid.UUID, ctx: dict[str, Any], config: dict[str, Any]
) -> dict[str, Any]:
    url_raw = render(config.get("url", ""), ctx).strip()
    if not url_raw:
        raise StepSkipped("URL is empty")

    validate_url_ssrf_safe(url_raw)

    method = (config.get("method") or "POST").upper()
    headers: dict[str, str] = {}
    headers_raw = config.get("headers")
    if headers_raw:
        rendered_headers = render(headers_raw, ctx).strip()
        if rendered_headers:
            try:
                parsed = json.loads(rendered_headers)
                if isinstance(parsed, dict):
                    headers = {str(k): str(v) for k, v in parsed.items()}
            except Exception as exc:
                logger.warning("Failed to parse http_request custom headers: %s", exc)

    body_raw = config.get("body")
    body: str | None = None
    if body_raw:
        body = render(body_raw, ctx)

    cred_id_raw = config.get("credential_id")
    if cred_id_raw:
        try:
            cred_id = uuid.UUID(str(cred_id_raw).strip())
            from app.services.credentials import get_decrypted_secret

            secret = await get_decrypted_secret(db, org_id, cred_id)
            if secret:
                headers.setdefault("Authorization", f"Bearer {secret}")
        except Exception as exc:
            logger.warning("Failed to inject credential into http_request: %s", exc)

    timeout = float(config.get("timeout_seconds") or 10)
    timeout = min(max(timeout, 1.0), 30.0)

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            resp = await client.request(method=method, url=url_raw, headers=headers, content=body)
            # Response truncation: max 256 KB
            raw_text = resp.text[:262144]
            return {
                "status_code": resp.status_code,
                "success": 200 <= resp.status_code < 300,
                "body": raw_text[:2000],
                "url": url_raw,
                "method": method,
            }
    except Exception as exc:
        raise AppError(f"HTTP request failed: {exc}", status_code=502) from exc


ACTIONS = {
    "action.add_tag": add_tag,
    "action.remove_tag": remove_tag,
    "action.assign": assign,
    "action.set_status": set_status,
    "action.set_priority": set_priority,
    "action.add_note": add_note,
    "action.create_lead": create_lead,
    "action.create_task": create_task,
    "action.http_request": http_request,
    "human.handover": handover,
}


def describe_test(node_type: str, ctx: dict[str, Any], config: dict[str, Any]) -> str:
    """What a step would have done, for test runs (which never touch real data)."""
    match node_type:
        case "action.send_message":
            return f"Would send: “{render(config['text'], ctx)}”"
        case "action.create_lead":
            return f"Would create lead “{render(config['title'], ctx, 200)}”"
        case "action.create_task":
            return f"Would create task “{render(config['title'], ctx, 200)}”"
        case "action.add_note":
            return f"Would add note “{render(config['body'], ctx, 200)}”"
        case "action.http_request":
            return (
                f"Would send HTTP {config.get('method', 'POST')} to {render(config.get('url', ''), ctx, 200)}"
            )
        case "human.handover":
            return "Would pause automations and hand the conversation to a person"
    return f"Would run {node_type.split('.')[-1].replace('_', ' ')}"
