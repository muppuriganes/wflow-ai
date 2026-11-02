from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


class AnalyticsOverviewOut(BaseModel):
    new_conversations: int
    open_conversations: int
    avg_response_time_seconds: float | None
    total_messages_in: int
    total_messages_out: int
    active_leads_count: int
    total_pipeline_value: float
    overdue_tasks_count: int
    workflow_runs_total: int
    workflow_success_rate: float | None


class DailyMessageVolume(BaseModel):
    date: date
    inbound: int
    outbound: int


class ChannelConversationStat(BaseModel):
    connection_id: str
    channel_name: str
    channel_type: str
    count: int


class AgentPerformanceStat(BaseModel):
    user_id: str | None
    name: str
    resolved_count: int
    avg_response_time_seconds: float | None


class LeadStageStat(BaseModel):
    stage: str
    count: int
    total_value: float


class TopFailingStep(BaseModel):
    node_type: str
    node_id: str
    failure_count: int
    last_error: str | None


class AnalyticsDataOut(BaseModel):
    from_date: datetime
    to_date: datetime
    range: str
    overview: AnalyticsOverviewOut
    conversations: dict[str, Any]
    messages: list[DailyMessageVolume]
    crm: dict[str, Any]
    workflows: dict[str, Any]
