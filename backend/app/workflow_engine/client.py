"""Temporal client access, shared by the API, the channel-event worker and the workflow worker."""

from datetime import datetime, timedelta
from typing import Any

from temporalio.client import (
    Client,
    Schedule,
    ScheduleActionStartWorkflow,
    ScheduleCalendarSpec,
    ScheduleOverlapPolicy,
    SchedulePolicy,
    ScheduleRange,
    ScheduleSpec,
    ScheduleState,
    ScheduleUpdate,
)
from temporalio.common import WorkflowIDReusePolicy
from temporalio.exceptions import WorkflowAlreadyStartedError
from temporalio.service import RPCError, RPCStatusCode

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.workflow_engine.types import ApprovalDecision, CustomerReply, RunInput, WebhookDeliveryInput
from app.workflow_engine.workflow import GraphWorkflow, ScheduleTriggerWorkflow, WebhookDeliveryWorkflow

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


def temporal_sched_id(schedule_id: str) -> str:
    return f"wfs-{schedule_id}"


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


async def start_webhook_delivery(inp: WebhookDeliveryInput) -> None:
    """One workflow per event and endpoint; starting it twice is a no-op."""
    client = await get_client()
    try:
        await client.start_workflow(
            WebhookDeliveryWorkflow.run,
            inp,
            id=f"whd-{inp.endpoint_id}-{inp.event['id']}",
            task_queue=get_settings().temporal_task_queue,
            id_reuse_policy=WorkflowIDReusePolicy.REJECT_DUPLICATE,
            execution_timeout=timedelta(hours=2),
        )
    except WorkflowAlreadyStartedError:
        pass


async def signal_reply(run_id: str, reply: CustomerReply) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.customer_replied, reply)


async def signal_approval(run_id: str, decision: ApprovalDecision) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.approval_decided, decision)


async def cancel(run_id: str) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).cancel()


def _hour_minute(config: dict[str, Any]) -> tuple[int, int]:
    h, m = (int(p) for p in str(config.get("time") or "09:00").split(":")[:2])
    return h, m


def build_schedule_spec(schedule_type: str, config: dict[str, Any], timezone: str) -> ScheduleSpec:
    """Configs are validated by the schedules service before they get here."""
    tz = timezone or "UTC"
    h, m = _hour_minute(config)
    if schedule_type == "once":
        y, mo, d = (int(p) for p in str(config["date"]).split("-")[:3])
        calendar = ScheduleCalendarSpec(
            year=[ScheduleRange(y)], month=[ScheduleRange(mo)], day_of_month=[ScheduleRange(d)],
            hour=[ScheduleRange(h)], minute=[ScheduleRange(m)],
        )  # fmt: skip
        return ScheduleSpec(calendars=[calendar], time_zone_name=tz)
    if schedule_type == "weekly":
        days = ",".join(str(DAY_NUMBERS[d]) for d in config["days"])
        cron = f"{m} {h} * * {days}"
    elif schedule_type == "monthly":
        cron = f"{m} {h} {int(config.get('day_of_month') or 1)} * *"
    elif schedule_type == "cron":
        cron = str(config["cron_expression"])
    else:  # daily
        cron = f"{m} {h} * * *"
    return ScheduleSpec(cron_expressions=[cron], time_zone_name=tz)


DAY_NUMBERS = {"sun": 0, "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6}


async def create_or_update_temporal_schedule(
    schedule_id: str,
    schedule_type: str,
    config: dict[str, Any],
    timezone: str,
    paused: bool = False,
) -> datetime | None:
    """Creates or replaces the Temporal schedule and returns its next fire time.
    Raises EngineUnavailableError, so callers never save a schedule that cannot fire."""
    client = await get_client()
    sched_id = temporal_sched_id(schedule_id)
    sched_obj = Schedule(
        action=ScheduleActionStartWorkflow(
            ScheduleTriggerWorkflow.run,
            {"schedule_id": schedule_id},
            id=f"wf-sched-{schedule_id}",
            task_queue=get_settings().temporal_task_queue,
        ),
        spec=build_schedule_spec(schedule_type, config, timezone),
        # A fire missed while the engine was down still runs if it is under 15 minutes late.
        policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP, catchup_window=timedelta(minutes=15)),
        state=ScheduleState(paused=paused),
    )
    try:
        handle = client.get_schedule_handle(sched_id)
        try:
            await handle.update(lambda _: ScheduleUpdate(schedule=sched_obj))
        except RPCError as exc:
            if exc.status != RPCStatusCode.NOT_FOUND:
                raise
            handle = await client.create_schedule(sched_id, sched_obj)
        desc = await handle.describe()
    except RPCError as exc:
        log.error("temporal_schedule_sync_failed", schedule_id=schedule_id, error=str(exc))
        raise EngineUnavailableError("Couldn't save the schedule in the workflow engine. Try again.") from exc
    return desc.info.next_action_times[0] if desc.info.next_action_times else None


async def next_fire_time(schedule_id: str) -> datetime | None:
    """Best effort (used to refresh the displayed next run after each fire)."""
    try:
        desc = await (await get_client()).get_schedule_handle(temporal_sched_id(schedule_id)).describe()
    except (RPCError, EngineUnavailableError):
        return None
    return desc.info.next_action_times[0] if desc.info.next_action_times else None


async def set_temporal_schedule_paused(schedule_id: str, paused: bool) -> None:
    try:
        handle = (await get_client()).get_schedule_handle(temporal_sched_id(schedule_id))
        await (handle.pause() if paused else handle.unpause())
    except RPCError as exc:
        log.error("temporal_schedule_pause_failed", schedule_id=schedule_id, error=str(exc))
        raise EngineUnavailableError(
            "Couldn't update the schedule in the workflow engine. Try again."
        ) from exc


async def delete_temporal_schedule(schedule_id: str) -> None:
    """Best effort: a fire for a deleted schedule finds no row and does nothing."""
    try:
        handle = (await get_client()).get_schedule_handle(temporal_sched_id(schedule_id))
        await handle.delete()
    except (RPCError, EngineUnavailableError) as exc:
        log.warning("temporal_delete_schedule_failed", schedule_id=schedule_id, error=str(exc))
