import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, StringConstraints

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ScheduleType = Literal["once", "daily", "weekly", "monthly", "cron"]
ScheduleStatus = Literal["active", "paused"]


class ScheduleCreate(BaseModel):
    workflow_id: uuid.UUID
    name: Name
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    schedule_type: ScheduleType = "daily"
    config: dict[str, Any] = Field(default_factory=dict)
    timezone: str | None = None
    target_tag_id: uuid.UUID | None = None


class ScheduleUpdate(BaseModel):
    name: Name | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] | None = None
    schedule_type: ScheduleType | None = None
    config: dict[str, Any] | None = None
    timezone: str | None = None
    target_tag_id: uuid.UUID | None = None


class ScheduleOut(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    workflow_id: uuid.UUID
    workflow_name: str
    name: str
    description: str | None
    status: ScheduleStatus
    schedule_type: ScheduleType
    config: dict[str, Any]
    timezone: str
    target_tag_id: uuid.UUID | None
    target_tag_name: str | None = None
    last_run_at: datetime | None
    next_run_at: datetime | None
    total_runs: int
    created_at: datetime
    updated_at: datetime
