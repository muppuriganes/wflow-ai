"""The Temporal workflow that interprets a compiled workflow plan.

Deterministic by construction: it only walks the plan, waits on timers and signals, and delegates
every side effect to activities. Delays, waits for a customer reply and approvals are durable —
they survive worker and server restarts and can last days.
"""

import asyncio
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError

with workflow.unsafe.imports_passed_through():
    from app.workflow_engine import activities as acts
    from app.workflow_engine.expressions import render
    from app.workflow_engine.types import (
        ApprovalDecision,
        ApprovalRequest,
        CustomerReply,
        NodeInput,
        NodeRecord,
        NodeResult,
        RunInput,
        RunState,
        WebhookDeliveryInput,
    )

MAX_STEPS = 200
ACTIVITY_RETRY = RetryPolicy(
    initial_interval=timedelta(seconds=2),
    backoff_coefficient=2.0,
    maximum_interval=timedelta(minutes=1),
    maximum_attempts=5,
)
UNIT_SECONDS = {"minutes": 60, "hours": 3600, "days": 86400}


@workflow.defn(name="WFlowGraph")
class GraphWorkflow:
    def __init__(self) -> None:
        self.replies: list[CustomerReply] = []
        self.decisions: dict[str, str] = {}
        self.scale = 1.0
        self.retry = ACTIVITY_RETRY

    @workflow.signal(name="customer_replied")
    def customer_replied(self, reply: CustomerReply) -> None:
        self.replies.append(reply)

    @workflow.signal(name="approval_decided")
    def approval_decided(self, decision: ApprovalDecision) -> None:
        self.decisions[decision.approval_id] = decision.decision

    async def _act(self, fn: Any, arg: Any, seconds: int = 60) -> Any:
        return await workflow.execute_activity(
            fn, arg, start_to_close_timeout=timedelta(seconds=seconds), retry_policy=self.retry
        )

    async def _state(
        self, inp: RunInput, status: str, waiting_for: str | None = None, error: str | None = None
    ) -> None:
        await self._act(
            acts.set_run_state, RunState(inp.run_id, inp.organization_id, status, waiting_for, error)
        )

    async def _record(self, inp: RunInput, node_id: str, node_type: str, status: str,
                      outcome: str | None = None, output: dict[str, Any] | None = None) -> None:  # fmt: skip
        await self._act(acts.record_node, NodeRecord(inp.run_id, inp.organization_id, node_id, node_type, status,
                                                  outcome, output or {}))  # fmt: skip

    async def _wait_step(
        self, inp: RunInput, ctx: dict[str, Any], node_id: str, node: dict[str, Any]
    ) -> str | None:
        """Steps the workflow performs itself. Returns the outcome handle."""
        t, cfg = node["type"], node["config"]
        if t == "logic.stop":
            await self._record(inp, node_id, t, "completed")
            return None
        if t == "logic.delay":
            seconds = float(cfg["amount"]) * UNIT_SECONDS[cfg["unit"]] * self.scale
            if inp.test:
                await self._record(
                    inp,
                    node_id,
                    t,
                    "skipped",
                    "out",
                    {"note": f"Test run: skipped a {cfg['amount']} {cfg['unit']} delay"},
                )
                return "out"
            await self._record(inp, node_id, t, "waiting")
            await self._state(inp, "WAITING", "delay")
            await workflow.sleep(timedelta(seconds=seconds))
            await self._state(inp, "RUNNING")
            await self._record(inp, node_id, t, "completed", "out", {"waited_seconds": seconds})
            return "out"
        if t == "logic.wait_for_reply":
            if inp.test:
                await self._record(
                    inp, node_id, t, "skipped", "replied", {"note": "Test run: assumed the customer replied"}
                )
                return "replied"
            seen = len(self.replies)
            await self._record(inp, node_id, t, "waiting")
            await self._state(inp, "WAITING", "reply")
            try:
                await workflow.wait_condition(lambda: len(self.replies) > seen,
                                              timeout=timedelta(minutes=float(cfg["timeout_minutes"]) * self.scale))  # fmt: skip
            except TimeoutError:
                await self._state(inp, "RUNNING")
                await self._record(inp, node_id, t, "completed", "timeout", {"result": "No reply in time"})
                return "timeout"
            reply = self.replies[-1]
            ctx["message"] = {"id": reply.message_id, "text": reply.text}
            await self._state(inp, "RUNNING")
            await self._record(inp, node_id, t, "completed", "replied", {"reply": reply.text})
            return "replied"
        if t == "human.approval":
            title = cfg.get("title") or "Approval"
            if inp.test:
                await self._record(
                    inp, node_id, t, "skipped", "approved", {"note": "Test run: assumed approved"}
                )
                return "approved"
            approval_id = await self._act(acts.create_approval, ApprovalRequest(
                inp.run_id, inp.organization_id, node_id, render(title, ctx, 200),
                render(cfg.get("details") or "", ctx, 2000) or None, cfg.get("assignee_user_id"),
                float(cfg["timeout_hours"]),
            ))  # fmt: skip
            await self._record(inp, node_id, t, "waiting", None, {"approval_id": approval_id})
            await self._state(inp, "WAITING", "approval")
            try:
                await workflow.wait_condition(lambda: approval_id in self.decisions,
                                              timeout=timedelta(hours=float(cfg["timeout_hours"]) * self.scale))  # fmt: skip
                outcome = self.decisions[approval_id]
            except TimeoutError:
                await workflow.execute_activity(acts.expire_approval, args=[inp.organization_id, approval_id],
                                                start_to_close_timeout=timedelta(seconds=60), retry_policy=self.retry)  # fmt: skip
                outcome = "timeout"
            await self._state(inp, "RUNNING")
            await self._record(
                inp, node_id, t, "completed", outcome, {"approval_id": approval_id, "decision": outcome}
            )
            return outcome
        raise ApplicationError(f"Not a workflow-native step: {t}", non_retryable=True)

    @workflow.run
    async def run(self, inp: RunInput) -> str:
        plan = inp.plan
        self.scale = inp.time_scale
        if inp.time_scale < 1:
            self.retry = RetryPolicy(initial_interval=timedelta(milliseconds=100), backoff_coefficient=1.5,
                                     maximum_interval=timedelta(seconds=1), maximum_attempts=5)  # fmt: skip
        try:
            ctx: dict[str, Any] = await self._act(acts.prepare_run, inp)
            await self._record(inp, plan["start"], plan["trigger"]["type"], "completed", "out",
                               {"trigger": plan["trigger"]["type"]})  # fmt: skip
            queue = list(plan["edges"].get(plan["start"], {}).get("out", []))
            steps = 0
            while queue:
                steps += 1
                if steps > MAX_STEPS:
                    raise ApplicationError("Too many steps", non_retryable=True)
                node_id = queue.pop(0)
                node = plan["nodes"][node_id]
                if node["type"].startswith("logic.") or node["type"] == "human.approval":
                    outcome = await self._wait_step(inp, ctx, node_id, node)
                else:
                    result: NodeResult = await self._act(acts.execute_node, NodeInput(
                        inp.run_id, inp.organization_id, node_id, node["type"], node["config"], ctx, inp.test,
                    ), seconds=120)  # fmt: skip
                    outcome = result.outcome
                    ctx.setdefault("variables", {}).update(result.variables or {})
                if outcome is None:
                    if node["type"] in ("logic.stop", "human.handover"):
                        queue.clear()
                    continue
                queue.extend(plan["edges"].get(node_id, {}).get(outcome, []))
            await self._state(inp, "COMPLETED")
            return "COMPLETED"
        except asyncio.CancelledError:
            # Temporal allows cleanup activities after a cancellation request.
            await self._state(inp, "CANCELLED", error="Cancelled by a team member")
            raise
        except (ActivityError, ApplicationError) as exc:
            cause = exc.cause if isinstance(exc, ActivityError) and exc.cause else exc
            await self._state(inp, "FAILED", error=str(cause)[:4000])
            return "FAILED"


@workflow.defn(name="ScheduleTriggerWorkflow")
class ScheduleTriggerWorkflow:
    """Started by a Temporal schedule on each fire; starts the scheduled workflow's runs."""

    @workflow.run
    async def run(self, inp: dict[str, Any]) -> str:
        # Temporal suffixes schedule-started workflow ids with the scheduled time: a stable key for
        # this fire, so activity retries never start the runs twice.
        res = await workflow.execute_activity(
            acts.dispatch_schedule_activity,
            {**inp, "fire_key": workflow.info().workflow_id},
            start_to_close_timeout=timedelta(minutes=5),
            retry_policy=ACTIVITY_RETRY,
        )
        return str(res)


@workflow.defn(name="WebhookDelivery")
class WebhookDeliveryWorkflow:
    """Delivers one event to one endpoint: up to 6 attempts, 30 s apart and doubling (about
    16 minutes in total), each logged in the endpoint's delivery history."""

    @workflow.run
    async def run(self, inp: WebhookDeliveryInput) -> str:
        fast = inp.time_scale < 1
        retry = RetryPolicy(
            initial_interval=timedelta(milliseconds=100) if fast else timedelta(seconds=30),
            backoff_coefficient=2.0,
            maximum_interval=timedelta(seconds=1) if fast else timedelta(minutes=10),
            maximum_attempts=6,
        )
        result: str = await workflow.execute_activity(
            acts.deliver_webhook_event, inp, start_to_close_timeout=timedelta(seconds=30), retry_policy=retry
        )
        return result
