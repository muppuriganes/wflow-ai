"""Temporal client access, shared by the API, the channel-event worker and the workflow worker."""

from datetime import timedelta

from temporalio.client import Client
from temporalio.common import WorkflowIDReusePolicy

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.workflow_engine.types import ApprovalDecision, CustomerReply, RunInput
from app.workflow_engine.workflow import GraphWorkflow

log = get_logger("workflow.client")

_client: Client | None = None


class EngineUnavailableError(AppError):
    status_code = 503
    code = "workflow_engine_unavailable"


async def get_client() -> Client:
    global _client
    if _client is None:
        settings = get_settings()
        try:
            _client = await Client.connect(settings.temporal_address, namespace=settings.temporal_namespace)
        except Exception as exc:
            log.error("temporal_connect_failed", error=str(exc))
            raise EngineUnavailableError("The workflow engine is not reachable") from exc
    return _client


def set_client(client: Client | None) -> None:
    """Tests inject a client bound to an in-process Temporal test server."""
    global _client
    _client = client


def temporal_id(run_id: str) -> str:
    return f"wfr-{run_id}"


async def start(inp: RunInput) -> str:
    client = await get_client()
    handle = await client.start_workflow(
        GraphWorkflow.run,
        inp,
        id=temporal_id(inp.run_id),
        task_queue=get_settings().temporal_task_queue,
        id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
        execution_timeout=timedelta(days=60),
    )
    return handle.id


async def signal_reply(run_id: str, reply: CustomerReply) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.customer_replied, reply)


async def signal_approval(run_id: str, decision: ApprovalDecision) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.approval_decided, decision)


async def cancel(run_id: str) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).cancel()
