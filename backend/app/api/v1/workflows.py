import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import DB, OrgCtx
from app.core.errors import AppError, NotFoundError
from app.core.rate_limit import enforce_rate_limit
from app.database.session import set_rls_context
from app.models import Workflow, WorkflowVersion
from app.schemas.common import Page
from app.schemas.workflows import (
    ApprovalDecisionIn,
    ApprovalOut,
    RunDetail,
    RunRequest,
    RunSummary,
    StatusChange,
    ValidationOut,
    VersionOut,
    WorkflowCreate,
    WorkflowOut,
    WorkflowSummary,
    WorkflowUpdate,
)
from app.services import workflows as svc
from app.workflow_engine.nodes import describe
from app.workflow_engine.triggers import create_and_start

router = APIRouter(prefix="/organizations/{org_id}", tags=["workflows"])
hooks = APIRouter(tags=["webhooks"])


@router.get("/workflow-node-types")
async def node_types(ctx: OrgCtx) -> list[dict[str, Any]]:
    """The step catalogue the builder renders (palette, settings forms, outputs)."""
    ctx.require("workflows.read")
    return describe()


@router.get("/workflows")
async def list_workflows(db: DB, ctx: OrgCtx, include_archived: bool = False) -> list[WorkflowSummary]:
    return await svc.list_workflows(db, ctx, include_archived)


@router.post("/workflows", status_code=status.HTTP_201_CREATED)
async def create_workflow(data: WorkflowCreate, db: DB, ctx: OrgCtx) -> WorkflowOut:
    definition = data.definition.model_dump() if data.definition else None
    return await svc.create_workflow(db, ctx, data.name, data.description, definition)


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> WorkflowOut:
    return await svc.get_workflow(db, ctx, workflow_id)


@router.patch("/workflows/{workflow_id}")
async def update_workflow(workflow_id: uuid.UUID, data: WorkflowUpdate, db: DB, ctx: OrgCtx) -> WorkflowOut:
    changes = data.model_dump(exclude_unset=True)
    if data.definition is not None:
        changes["definition"] = data.definition.model_dump()
    return await svc.update_workflow(db, ctx, workflow_id, changes)


@router.post("/workflows/{workflow_id}/validate")
async def validate(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> ValidationOut:
    return await svc.validate(db, ctx, workflow_id)


class PublishResult(BaseModel):
    workflow: WorkflowOut
    validation: ValidationOut


@router.post("/workflows/{workflow_id}/publish")
async def publish(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> PublishResult:
    """Publishes only if validation passes; otherwise returns the problems (and publishes nothing)."""
    workflow, validation = await svc.publish_workflow(db, ctx, workflow_id)
    return PublishResult(workflow=workflow, validation=validation)


@router.post("/workflows/{workflow_id}/status")
async def set_status(workflow_id: uuid.UUID, data: StatusChange, db: DB, ctx: OrgCtx) -> WorkflowOut:
    return await svc.set_status(db, ctx, workflow_id, data.status)


@router.post("/workflows/{workflow_id}/duplicate", status_code=status.HTTP_201_CREATED)
async def duplicate(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> WorkflowOut:
    return await svc.duplicate(db, ctx, workflow_id)


@router.post("/workflows/{workflow_id}/webhook/regenerate")
async def regenerate_webhook(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> WorkflowOut:
    return await svc.regenerate_webhook(db, ctx, workflow_id)


@router.get("/workflows/{workflow_id}/versions")
async def versions(workflow_id: uuid.UUID, db: DB, ctx: OrgCtx) -> list[VersionOut]:
    return await svc.list_versions(db, ctx, workflow_id)


@router.post("/workflows/{workflow_id}/versions/{version_id}/restore")
async def restore_version(workflow_id: uuid.UUID, version_id: uuid.UUID, db: DB, ctx: OrgCtx) -> WorkflowOut:
    return await svc.restore_version(db, ctx, workflow_id, version_id)


class TestRunResult(BaseModel):
    run: RunSummary | None
    validation: ValidationOut


@router.post("/workflows/{workflow_id}/test")
async def test_run(workflow_id: uuid.UUID, data: RunRequest, db: DB, ctx: OrgCtx) -> TestRunResult:
    run, validation = await svc.start_test_run(
        db, ctx, workflow_id, data.conversation_id, data.sample_message, data.webhook
    )
    return TestRunResult(run=run, validation=validation)


@router.post("/workflows/{workflow_id}/execute", status_code=status.HTTP_202_ACCEPTED)
async def execute(workflow_id: uuid.UUID, data: RunRequest, db: DB, ctx: OrgCtx) -> RunSummary:
    return await svc.start_manual_run(db, ctx, workflow_id, data.conversation_id)


@router.get("/workflow-runs")
async def list_runs(
    db: DB,
    ctx: OrgCtx,
    workflow_id: uuid.UUID | None = None,
    status_filter: Annotated[
        Literal["QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"] | None,
        Query(alias="status"),
    ] = None,
    include_tests: bool = False,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
) -> Page[RunSummary]:
    items, total = await svc.list_runs(
        db, ctx, workflow_id=workflow_id, status=status_filter, include_tests=include_tests, page=page,
        page_size=page_size,
    )  # fmt: skip
    return Page(items=items, total=total, page=page, page_size=page_size)


@router.get("/workflow-runs/{run_id}")
async def get_run(run_id: uuid.UUID, db: DB, ctx: OrgCtx) -> RunDetail:
    return await svc.get_run(db, ctx, run_id)


@router.post("/workflow-runs/{run_id}/retry", status_code=status.HTTP_202_ACCEPTED)
async def retry_run(run_id: uuid.UUID, db: DB, ctx: OrgCtx) -> RunSummary:
    return await svc.retry_run(db, ctx, run_id)


@router.post("/workflow-runs/{run_id}/cancel")
async def cancel_run(run_id: uuid.UUID, db: DB, ctx: OrgCtx) -> RunSummary:
    return await svc.cancel_run(db, ctx, run_id)


@router.get("/approvals")
async def list_approvals(
    db: DB, ctx: OrgCtx, status_filter: Annotated[str | None, Query(alias="status", max_length=20)] = None
) -> list[ApprovalOut]:
    return await svc.list_approvals(db, ctx, status_filter)


@router.post("/approvals/{approval_id}/decision")
async def decide(approval_id: uuid.UUID, data: ApprovalDecisionIn, db: DB, ctx: OrgCtx) -> ApprovalOut:
    return await svc.decide_approval(db, ctx, approval_id, data.decision, data.note)


# --- Public webhook trigger ------------------------------------------------------------


@hooks.post("/hooks/{token}", status_code=status.HTTP_202_ACCEPTED)
async def webhook(token: str, request: Request, db: DB) -> dict[str, str]:
    """Starts a webhook-triggered workflow. The token in the URL is the credential; it can be
    regenerated in the builder. Body: a JSON object (≤ 64 KB). Optional `Idempotency-Key` header
    makes retries from the caller start the workflow only once."""
    if not (20 <= len(token) <= 64):
        raise NotFoundError("Unknown webhook")
    await enforce_rate_limit("webhook", token, limit=60, window_seconds=60)
    body = await request.body()
    if len(body) > 64 * 1024:
        raise AppError("Payload too large (max 64 KB)", code="payload_too_large")
    try:
        payload = await request.json() if body else {}
    except ValueError as exc:
        raise AppError("Body must be JSON", code="invalid_json") from exc
    if not isinstance(payload, dict):
        raise AppError("Body must be a JSON object", code="invalid_json")

    row = (
        await db.execute(text("SELECT id, organization_id FROM workflow_by_webhook_token(:t)"), {"t": token})
    ).first()
    if row is None:
        raise NotFoundError("Unknown webhook")
    await set_rls_context(db, user_id=None, org_id=row.organization_id)
    wf = await db.get(Workflow, row.id)
    version = (
        await db.get(WorkflowVersion, wf.published_version_id) if wf and wf.published_version_id else None
    )
    if wf is None or version is None:
        raise NotFoundError("Unknown webhook")
    key = request.headers.get("idempotency-key", "")[:100] or None
    run = await create_and_start(
        db, workflow=wf, version=version, plan=version.compiled, trigger_type="trigger.webhook",
        payload={"webhook": payload}, event_key=f"hook:{key}" if key else None, conversation_id=None, contact_id=None,
    )  # fmt: skip
    return {"status": "accepted" if run else "duplicate", "run_id": str(run.id) if run else ""}
