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

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.workflow_engine.types import ApprovalDecision, CustomerReply, RunInput
from app.workflow_engine.workflow import GraphWorkflow, ScheduleTriggerWorkflow

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


async def signal_reply(run_id: str, reply: CustomerReply) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.customer_replied, reply)


async def signal_approval(run_id: str, decision: ApprovalDecision) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).signal(GraphWorkflow.approval_decided, decision)


async def cancel(run_id: str) -> None:
    client = await get_client()
    await client.get_workflow_handle(temporal_id(run_id)).cancel()


def build_schedule_spec(schedule_type: str, config: dict[str, Any], timezone: str) -> ScheduleSpec:
    tz = timezone or "UTC"
    if schedule_type == "daily":
        time_str = config.get("time") or "09:00"
        parts = time_str.split(":")
        h = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 9
        m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        cron = f"{m} {h} * * *"
        return ScheduleSpec(cron_expressions=[cron], time_zone_name=tz)
    elif schedule_type == "weekly":
        time_str = config.get("time") or "09:00"
        parts = time_str.split(":")
        h = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 9
        m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        days = config.get("days") or ["mon"]
        day_map = {"sun": "0", "mon": "1", "tue": "2", "wed": "3", "thu": "4", "fri": "5", "sat": "6"}
        day_list = [day_map[str(d).lower()] for d in days if str(d).lower() in day_map] or ["1"]
        cron = f"{m} {h} * * {','.join(day_list)}"
        return ScheduleSpec(cron_expressions=[cron], time_zone_name=tz)
    elif schedule_type == "monthly":
        time_str = config.get("time") or "09:00"
        parts = time_str.split(":")
        h = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 9
        m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        dom = max(1, min(31, int(config.get("day_of_month") or 1)))
        cron = f"{m} {h} {dom} * *"
        return ScheduleSpec(cron_expressions=[cron], time_zone_name=tz)
    elif schedule_type == "cron":
        cron = config.get("cron_expression") or "0 9 * * 1-5"
        return ScheduleSpec(cron_expressions=[cron], time_zone_name=tz)
    elif schedule_type == "once":
        date_str = config.get("date")
        time_str = config.get("time") or "09:00"
        parts = time_str.split(":")
        h = int(parts[0]) if len(parts) > 0 and parts[0].isdigit() else 9
        m = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        if date_str and "-" in date_str:
            y, mo, d = [int(p) for p in date_str.split("-")[:3]]
            return ScheduleSpec(
                calendars=[
                    ScheduleCalendarSpec(
                        year=[ScheduleRange(y)],
                        month=[ScheduleRange(mo)],
                        day_of_month=[ScheduleRange(d)],
                        hour=[ScheduleRange(h)],
                        minute=[ScheduleRange(m)],
                    )
                ],
                time_zone_name=tz,
            )
        return ScheduleSpec(cron_expressions=[f"{m} {h} * * *"], time_zone_name=tz)
    return ScheduleSpec(cron_expressions=["0 9 * * *"], time_zone_name=tz)


async def create_or_update_temporal_schedule(
    schedule_id: str,
    schedule_type: str,
    config: dict[str, Any],
    timezone: str,
    paused: bool = False,
) -> datetime | None:
    try:
        client = await get_client()
        sched_id = temporal_sched_id(schedule_id)
        spec = build_schedule_spec(schedule_type, config, timezone)
        policy = SchedulePolicy(
            overlap=ScheduleOverlapPolicy.SKIP,
            catchup_window=timedelta(minutes=15),
        )
        action = ScheduleActionStartWorkflow(
            ScheduleTriggerWorkflow.run,
            {"schedule_id": schedule_id},
            id=f"wf-sched-{schedule_id}",
            task_queue=get_settings().temporal_task_queue,
        )
        sched_obj = Schedule(
            action=action,
            spec=spec,
            policy=policy,
            state=ScheduleState(paused=paused),
        )
        try:
            handle = client.get_schedule_handle(sched_id)
            await handle.update(lambda _: ScheduleUpdate(schedule=sched_obj))
        except Exception:
            handle = await client.create_schedule(sched_id, sched_obj)
        desc = await handle.describe()
        if desc.info.next_action_times:
            return desc.info.next_action_times[0]
        return None
    except Exception as exc:
        log.warning("temporal_schedule_sync_failed", schedule_id=schedule_id, error=str(exc))
        return None


async def pause_temporal_schedule(schedule_id: str) -> None:
    try:
        client = await get_client()
        handle = client.get_schedule_handle(temporal_sched_id(schedule_id))
        await handle.pause()
    except Exception as exc:
        log.warning("temporal_pause_schedule_failed", schedule_id=schedule_id, error=str(exc))


async def unpause_temporal_schedule(schedule_id: str) -> None:
    try:
        client = await get_client()
        handle = client.get_schedule_handle(temporal_sched_id(schedule_id))
        await handle.unpause()
    except Exception as exc:
        log.warning("temporal_unpause_schedule_failed", schedule_id=schedule_id, error=str(exc))


async def delete_temporal_schedule(schedule_id: str) -> None:
    try:
        client = await get_client()
        handle = client.get_schedule_handle(temporal_sched_id(schedule_id))
        await handle.delete()
    except Exception as exc:
        log.warning("temporal_delete_schedule_failed", schedule_id=schedule_id, error=str(exc))
