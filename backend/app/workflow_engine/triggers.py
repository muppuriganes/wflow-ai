"""Starting runs: from customer messages, by a person, or by webhook.

Rules for message triggers (all enforced here, not in the UI):
- a conversation under human takeover never triggers or resumes automations;
- if a run is waiting for this customer's reply, the message resumes it and starts nothing new;
- one active run per workflow per conversation (no pile-up while a run is still going);
- each message starts each workflow at most once (redeliveries are ignored).
"""

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.database.session import SessionFactory, set_rls_context
from app.models import Conversation, Workflow, WorkflowRun, WorkflowVersion
from app.services.realtime import publish
from app.workflow_engine import client as engine
from app.workflow_engine.expressions import keywords_match
from app.workflow_engine.types import CustomerReply, RunInput

log = get_logger("workflow.triggers")

ACTIVE = ("QUEUED", "RUNNING", "WAITING")


async def create_and_start(
    db: AsyncSession,
    *,
    workflow: Workflow,
    version: WorkflowVersion | None,
    plan: dict[str, Any],
    trigger_type: str,
    payload: dict[str, Any],
    event_key: str | None,
    conversation_id: uuid.UUID | None,
    contact_id: uuid.UUID | None,
    is_test: bool = False,
    started_by: uuid.UUID | None = None,
    retry_of: uuid.UUID | None = None,
) -> WorkflowRun | None:
    """Creates the run row (idempotent on event_key) and starts its Temporal execution."""
    run_id = uuid.uuid4()
    inserted = await db.scalar(
        insert(WorkflowRun)
        .values(
            id=run_id, organization_id=workflow.organization_id, workflow_id=workflow.id,
            version_id=version.id if version else None, status="QUEUED", is_test=is_test, trigger_type=trigger_type,
            trigger_event_key=event_key, trigger_payload=payload, conversation_id=conversation_id,
            contact_id=contact_id, temporal_workflow_id=engine.temporal_id(str(run_id)),
            started_by_user_id=started_by, retry_of_run_id=retry_of,
        )
        .on_conflict_do_nothing()
        .returning(WorkflowRun.id)
    )  # fmt: skip
    await db.commit()
    if inserted is None:
        return None  # this event already started this workflow
    run = await db.get(WorkflowRun, run_id)
    assert run is not None
    try:
        await engine.start(
            RunInput(
                str(run_id), str(workflow.organization_id), plan, is_test, get_settings().workflow_time_scale
            )
        )
    except Exception as exc:
        log.error("run_start_failed", run_id=str(run_id), error=str(exc))
        run.status = "FAILED"
        run.error = "The workflow engine was not reachable. Use Retry when it is back."
        await db.commit()
    await publish(workflow.organization_id, "run.updated", run_id=run_id)
    return run


async def _active_workflows(
    db: AsyncSession, org_id: uuid.UUID, trigger_types: list[str]
) -> list[tuple[Workflow, WorkflowVersion]]:
    rows = await db.execute(
        select(Workflow, WorkflowVersion)
        .join(WorkflowVersion, WorkflowVersion.id == Workflow.published_version_id)
        .where(
            Workflow.organization_id == org_id,
            Workflow.status == "active",
            Workflow.trigger_type.in_(trigger_types),
        )
    )
    return [(w, v) for w, v in rows.all()]


def _matches(version: WorkflowVersion, connection_id: uuid.UUID, text: str | None) -> bool:
    cfg = version.compiled["trigger"]["config"]
    if cfg.get("connection_id") and cfg["connection_id"] != str(connection_id):
        return False
    if version.compiled["trigger"]["type"] == "trigger.message_received" and cfg.get("keywords"):
        return keywords_match(text, cfg["keywords"], cfg.get("match", "any"))
    return True


async def dispatch_inbound(
    org_id: uuid.UUID,
    conversation_id: uuid.UUID,
    message_id: uuid.UUID,
    text: str | None,
    *,
    new_conversation: bool,
    new_contact: bool,
) -> int:
    """Called by the channel-event worker after an inbound message is stored. Returns runs started."""
    async with SessionFactory() as db:
        await set_rls_context(db, user_id=None, org_id=org_id)
        conv = await db.get(Conversation, conversation_id)
        if conv is None or conv.automation_paused:
            return 0

        waiting = (await db.scalars(
            select(WorkflowRun.id).where(WorkflowRun.conversation_id == conversation_id,
                                         WorkflowRun.status == "WAITING", WorkflowRun.waiting_for == "reply")
        )).all()  # fmt: skip
        if waiting:
            for run_id in waiting:
                try:
                    await engine.signal_reply(str(run_id), CustomerReply(str(message_id), text))
                except Exception as exc:
                    log.error("signal_reply_failed", run_id=str(run_id), error=str(exc))
            return 0

        types = ["trigger.message_received"]
        if new_conversation:
            types.append("trigger.new_conversation")
        if new_contact:
            types.append("trigger.new_contact")
        started = 0
        for workflow, version in await _active_workflows(db, org_id, types):
            if not _matches(version, conv.connection_id, text):
                continue
            busy = await db.scalar(
                select(WorkflowRun.id).where(WorkflowRun.workflow_id == workflow.id,
                                             WorkflowRun.conversation_id == conversation_id,
                                             WorkflowRun.status.in_(ACTIVE)).limit(1)
            )  # fmt: skip
            if busy:
                continue
            run = await create_and_start(
                db, workflow=workflow, version=version, plan=version.compiled, trigger_type=workflow.trigger_type or "",
                payload={"message_id": str(message_id), "message_text": text}, event_key=f"msg:{message_id}",
                conversation_id=conversation_id, contact_id=conv.contact_id,
            )  # fmt: skip
            started += run is not None
        return started
