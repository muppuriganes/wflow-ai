import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class Definition(BaseModel):
    nodes: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    edges: list[dict[str, Any]] = Field(default_factory=list, max_length=300)
    viewport: dict[str, Any] | None = None


class WorkflowCreate(BaseModel):
    name: Name
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    definition: Definition | None = None


class WorkflowUpdate(BaseModel):
    name: Name | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    definition: Definition | None = None


class IssueOut(BaseModel):
    message: str
    node_id: str | None


class ValidationOut(BaseModel):
    ok: bool
    errors: list[IssueOut]
    warnings: list[IssueOut]


class RunStats(BaseModel):
    total_7d: int
    failed_7d: int
    last_status: str | None
    last_run_at: datetime | None


class WorkflowSummary(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    status: Literal["draft", "active", "paused", "archived"]
    trigger_type: str | None
    published_version: int | None
    has_unpublished_changes: bool
    stats: RunStats
    updated_at: datetime


class WorkflowOut(WorkflowSummary):
    definition: dict[str, Any]
    webhook_url: str | None


class VersionOut(BaseModel):
    id: uuid.UUID
    version: int
    published_by: str | None
    created_at: datetime
    is_current: bool


class StatusChange(BaseModel):
    status: Literal["active", "paused", "archived"]


class RunRequest(BaseModel):
    conversation_id: uuid.UUID | None = None
    sample_message: Annotated[str, StringConstraints(max_length=1000)] | None = None
    webhook: dict[str, Any] | None = None


class NodeRunOut(BaseModel):
    node_id: str
    node_type: str
    status: str
    attempt: int
    outcome: str | None
    input: dict[str, Any]
    output: dict[str, Any]
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None


class RunSummary(BaseModel):
    id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_name: str
    version: int | None
    status: str
    is_test: bool
    trigger_type: str
    conversation_id: uuid.UUID | None
    contact_name: str | None
    waiting_for: str | None
    error: str | None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    duration_ms: int | None
    node_count: int
    failed_nodes: int
    retries: int


class RunDetail(RunSummary):
    trigger_payload: dict[str, Any]
    nodes: list[NodeRunOut]
    definition: dict[str, Any] | None
    retry_of_run_id: uuid.UUID | None


class ApprovalOut(BaseModel):
    id: uuid.UUID
    run_id: uuid.UUID
    workflow_name: str
    title: str
    details: str | None
    status: str
    assignee: str | None
    decided_by: str | None
    decided_at: datetime | None
    decision_note: str | None
    expires_at: datetime | None
    created_at: datetime


class ApprovalDecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
