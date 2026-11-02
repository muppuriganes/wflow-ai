"""Workflow automation.

A workflow's editable graph lives in `draft_definition`. Publishing validates and compiles it into
an immutable `workflow_versions` row; runs always reference the exact version they executed, so
editing a workflow never changes the behaviour of runs already in flight (ADR-010).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base, CreatedAt, Timestamps, UUIDPrimaryKey

WORKFLOW_STATUSES = ("draft", "active", "paused", "archived")
RUN_STATUSES = ("QUEUED", "RUNNING", "WAITING", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT")
FINISHED_RUN_STATUSES = frozenset({"COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"})


class Workflow(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "workflows"
    __table_args__ = (Index("ix_workflows_org_status", "organization_id", "status"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    # Editable graph: {"nodes": [...], "edges": [...]} in the editor's format.
    draft_definition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    published_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_versions.id", ondelete="SET NULL", use_alter=True)
    )
    # Denormalised from the published version so triggers can be matched with one indexed query.
    trigger_type: Mapped[str | None] = mapped_column(String(40))
    # Secret for webhook-triggered workflows (shown to managers; regenerate to revoke).
    webhook_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class WorkflowVersion(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "workflow_versions"
    __table_args__ = (
        UniqueConstraint("workflow_id", "version", name="uq_workflow_versions_workflow_version"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB)  # as edited
    compiled: Mapped[dict[str, Any]] = mapped_column(JSONB)  # validated execution plan
    published_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )


class WorkflowRun(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "workflow_runs"
    __table_args__ = (
        Index("ix_workflow_runs_org_created", "organization_id", text("created_at DESC")),
        Index("ix_workflow_runs_workflow_created", "workflow_id", text("created_at DESC")),
        # A trigger event starts each workflow at most once (redelivered events are ignored).
        Index(
            "uq_workflow_runs_trigger_event",
            "workflow_id",
            "trigger_event_key",
            unique=True,
            postgresql_where=text("trigger_event_key IS NOT NULL"),
        ),
        Index("ix_workflow_runs_waiting_conversation", "conversation_id",
              postgresql_where=text("status = 'WAITING'")),
    )  # fmt: skip

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"))
    version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_versions.id", ondelete="SET NULL")
    )
    status: Mapped[str] = mapped_column(String(20), default="QUEUED", server_default="QUEUED")
    is_test: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    trigger_type: Mapped[str] = mapped_column(String(40))
    trigger_event_key: Mapped[str | None] = mapped_column(String(200))
    trigger_payload: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL")
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    temporal_workflow_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    waiting_for: Mapped[str | None] = mapped_column(String(20))  # reply | approval | delay
    error: Mapped[str | None] = mapped_column(Text)
    retry_of_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("workflow_runs.id", ondelete="SET NULL")
    )
    started_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]


class NodeRun(UUIDPrimaryKey, CreatedAt, Base):
    __tablename__ = "node_runs"
    __table_args__ = (Index("ix_node_runs_run_started", "run_id", "started_at"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"))
    node_id: Mapped[str] = mapped_column(String(64))
    node_type: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(
        String(20)
    )  # running | completed | failed | waiting | skipped | cancelled
    attempt: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    input: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    output: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    outcome: Mapped[str | None] = mapped_column(String(30))  # which output handle was taken
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None]
    finished_at: Mapped[datetime | None]


class Approval(UUIDPrimaryKey, Timestamps, Base):
    """Human-in-the-loop decision requested by a workflow."""

    __tablename__ = "approvals"
    __table_args__ = (Index("ix_approvals_org_status", "organization_id", "status"),)

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflow_runs.id", ondelete="CASCADE"), index=True)
    node_id: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(200))
    details: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    assignee_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    decided_at: Mapped[datetime | None]
    decision_note: Mapped[str | None] = mapped_column(String(500))
    expires_at: Mapped[datetime | None]


class Schedule(UUIDPrimaryKey, Timestamps, Base):
    """Scheduled and recurring workflow runs."""

    __tablename__ = "schedules"
    __table_args__ = (
        Index("ix_schedules_org_status", "organization_id", "status"),
        Index("ix_schedules_workflow", "workflow_id"),
    )

    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"))
    workflow_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workflows.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(
        String(20), default="active", server_default="active"
    )  # active | paused
    schedule_type: Mapped[str] = mapped_column(
        String(20), default="daily", server_default="daily"
    )  # once | daily | weekly | monthly | cron
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    timezone: Mapped[str] = mapped_column(String(50), default="UTC", server_default="UTC")
    target_tag_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tags.id", ondelete="SET NULL"))
    temporal_schedule_id: Mapped[str | None] = mapped_column(String(100), unique=True)
    last_run_at: Mapped[datetime | None]
    next_run_at: Mapped[datetime | None]
    total_runs: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class WorkflowTemplate(UUIDPrimaryKey, Timestamps, Base):
    """Ready-made workflow templates: built-in system starters and private org templates."""

    __tablename__ = "workflow_templates"
    __table_args__ = (
        Index("ix_workflow_templates_category", "category"),
        Index("ix_workflow_templates_org", "organization_id"),
    )

    organization_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str | None] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(50), default="General", server_default="General")
    definition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
