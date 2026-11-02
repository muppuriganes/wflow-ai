"""Serializable inputs/outputs exchanged between the Temporal workflow and its activities.
Kept free of database or framework imports so the workflow sandbox can load it."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class RunInput:
    run_id: str
    organization_id: str
    plan: dict[str, Any]
    test: bool = False
    time_scale: float = 1.0  # see Settings.workflow_time_scale


@dataclass
class NodeInput:
    run_id: str
    organization_id: str
    node_id: str
    node_type: str
    config: dict[str, Any]
    context: dict[str, Any]
    test: bool = False


@dataclass
class NodeResult:
    outcome: str | None
    output: dict[str, Any] = field(default_factory=dict)
    variables: dict[str, Any] = field(default_factory=dict)


@dataclass
class NodeRecord:
    """For steps the workflow itself performs (delays, waits, approvals, stop)."""

    run_id: str
    organization_id: str
    node_id: str
    node_type: str
    status: str  # running | waiting | completed | skipped
    outcome: str | None = None
    output: dict[str, Any] = field(default_factory=dict)
    input: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunState:
    run_id: str
    organization_id: str
    status: str
    waiting_for: str | None = None
    error: str | None = None


@dataclass
class ApprovalRequest:
    run_id: str
    organization_id: str
    node_id: str
    title: str
    details: str | None
    assignee_user_id: str | None
    timeout_hours: float


@dataclass
class ApprovalDecision:
    approval_id: str
    decision: str  # approved | rejected
    decided_by: str | None = None


@dataclass
class CustomerReply:
    message_id: str
    text: str | None
