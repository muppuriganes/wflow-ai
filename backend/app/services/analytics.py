"""Analytics service: real data aggregations for conversations, messages, CRM, workflows, and CSV export."""

import csv
import io
import uuid
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    ChannelConnection,
    Contact,
    Conversation,
    FollowUpTask,
    Lead,
    Message,
    NodeRun,
    Organization,
    User,
    WorkflowRun,
)
from app.schemas.analytics import (
    AgentPerformanceStat,
    AnalyticsDataOut,
    AnalyticsOverviewOut,
    ChannelConversationStat,
    DailyMessageVolume,
    LeadStageStat,
    TopFailingStep,
)


def _resolve_timeframe(
    org_tz: str,
    range_str: str = "7d",
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> tuple[datetime, datetime]:
    tz = ZoneInfo(org_tz or "UTC")
    now = datetime.now(tz)
    end_dt = to_date or now

    if range_str == "custom" and from_date:
        start_dt = from_date
    elif range_str == "30d":
        start_dt = end_dt - timedelta(days=30)
    elif range_str == "90d":
        start_dt = end_dt - timedelta(days=90)
    else:  # default 7d
        start_dt = end_dt - timedelta(days=7)

    # Convert to UTC for DB queries
    return start_dt.astimezone(UTC), end_dt.astimezone(UTC)


async def get_overview_metrics(db: AsyncSession, org_id: uuid.UUID) -> AnalyticsOverviewOut:
    org = await db.get(Organization, org_id)
    tz = org.timezone if org else "UTC"
    start_dt, end_dt = _resolve_timeframe(tz, "7d")

    # 1. Conversations
    new_convs = (
        await db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.organization_id == org_id,
                Conversation.created_at >= start_dt,
                Conversation.created_at <= end_dt,
            )
        )
        or 0
    )

    open_convs = (
        await db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.organization_id == org_id,
                Conversation.status.in_(("OPEN", "ASSIGNED", "PENDING")),
            )
        )
        or 0
    )

    # 2. Messages In / Out
    msg_counts = (
        await db.execute(
            select(
                func.count(case((Message.direction == "inbound", 1))),
                func.count(case((Message.direction == "outbound", 1))),
            ).where(
                Message.organization_id == org_id,
                Message.created_at >= start_dt,
                Message.created_at <= end_dt,
            )
        )
    ).first()
    msgs_in = msg_counts[0] if msg_counts else 0
    msgs_out = msg_counts[1] if msg_counts else 0

    # 3. CRM Leads & Pipeline Value
    leads_summary = (
        await db.execute(
            select(
                func.count(Lead.id),
                func.coalesce(func.sum(Lead.value_amount), 0),
            ).where(
                Lead.organization_id == org_id,
                Lead.stage.notin_(("CONVERTED", "LOST")),
            )
        )
    ).first()
    active_leads = leads_summary[0] if leads_summary else 0
    pipeline_val = float(leads_summary[1]) if leads_summary else 0.0

    # 4. Overdue Tasks
    now_utc = datetime.now(UTC)
    overdue_tasks = (
        await db.scalar(
            select(func.count(FollowUpTask.id)).where(
                FollowUpTask.organization_id == org_id,
                FollowUpTask.completed_at.is_(None),
                FollowUpTask.due_at < now_utc,
            )
        )
        or 0
    )

    # 5. Workflows
    wf_counts = (
        await db.execute(
            select(
                func.count(WorkflowRun.id),
                func.count(case((WorkflowRun.status == "COMPLETED", 1))),
                func.count(case((WorkflowRun.status.in_(("FAILED", "TIMED_OUT")), 1))),
            ).where(
                WorkflowRun.organization_id == org_id,
                WorkflowRun.is_test.is_(False),
                WorkflowRun.created_at >= start_dt,
                WorkflowRun.created_at <= end_dt,
            )
        )
    ).first()
    runs_total = wf_counts[0] if wf_counts else 0
    runs_completed = wf_counts[1] if wf_counts else 0
    runs_failed = wf_counts[2] if wf_counts else 0
    finished = runs_completed + runs_failed
    wf_success_rate = (
        (runs_completed / finished * 100.0) if finished > 0 else (100.0 if runs_total > 0 else None)
    )

    # 6. Response time calculation:
    # Average seconds between first inbound and first outbound in conversations
    avg_response_time = await _calculate_avg_response_time(db, org_id, start_dt, end_dt)

    return AnalyticsOverviewOut(
        new_conversations=new_convs,
        open_conversations=open_convs,
        avg_response_time_seconds=avg_response_time,
        total_messages_in=msgs_in,
        total_messages_out=msgs_out,
        active_leads_count=active_leads,
        total_pipeline_value=pipeline_val,
        overdue_tasks_count=overdue_tasks,
        workflow_runs_total=runs_total,
        workflow_success_rate=wf_success_rate,
    )


async def get_full_analytics(
    db: AsyncSession,
    org_id: uuid.UUID,
    range_str: str = "7d",
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> AnalyticsDataOut:
    org = await db.get(Organization, org_id)
    tz_str = org.timezone if org else "UTC"
    start_dt, end_dt = _resolve_timeframe(tz_str, range_str, from_date, to_date)

    overview = await get_overview_metrics(db, org_id)

    # 1. Conversations details
    resolved_count = (
        await db.scalar(
            select(func.count(Conversation.id)).where(
                Conversation.organization_id == org_id,
                Conversation.resolved_at >= start_dt,
                Conversation.resolved_at <= end_dt,
            )
        )
        or 0
    )

    channel_rows = await db.execute(
        select(
            ChannelConnection.id,
            ChannelConnection.display_name,
            ChannelConnection.channel_type,
            func.count(Conversation.id),
        )
        .join(Conversation, Conversation.connection_id == ChannelConnection.id)
        .where(
            Conversation.organization_id == org_id,
            Conversation.created_at >= start_dt,
            Conversation.created_at <= end_dt,
        )
        .group_by(ChannelConnection.id, ChannelConnection.display_name, ChannelConnection.channel_type)
    )
    by_channel = [
        ChannelConversationStat(
            connection_id=str(cid),
            channel_name=name,
            channel_type=ctype,
            count=cnt,
        ).model_dump()
        for cid, name, ctype, cnt in channel_rows.all()
    ]

    agent_rows = await db.execute(
        select(
            User.id,
            User.full_name,
            func.count(Conversation.id),
        )
        .join(Conversation, Conversation.assigned_user_id == User.id)
        .where(
            Conversation.organization_id == org_id,
            Conversation.resolved_at >= start_dt,
            Conversation.resolved_at <= end_dt,
        )
        .group_by(User.id, User.full_name)
    )
    by_agent = [
        AgentPerformanceStat(
            user_id=str(uid),
            name=name,
            resolved_count=cnt,
            avg_response_time_seconds=None,
        ).model_dump()
        for uid, name, cnt in agent_rows.all()
    ]

    # 2. Daily message volume series
    msg_rows = await db.execute(
        select(
            Message.created_at,
            Message.direction,
        ).where(
            Message.organization_id == org_id,
            Message.created_at >= start_dt,
            Message.created_at <= end_dt,
        )
    )
    tz = ZoneInfo(tz_str)
    daily_map: dict[str, dict[str, int]] = {}
    # Seed all days in timeframe so chart has no missing holes
    curr = start_dt.astimezone(tz).date()
    end_date = end_dt.astimezone(tz).date()
    while curr <= end_date:
        daily_map[curr.isoformat()] = {"inbound": 0, "outbound": 0}
        curr += timedelta(days=1)

    for created_at, direction in msg_rows.all():
        d_str = created_at.astimezone(tz).date().isoformat()
        if d_str in daily_map:
            if direction == "inbound":
                daily_map[d_str]["inbound"] += 1
            else:
                daily_map[d_str]["outbound"] += 1

    daily_messages = [
        DailyMessageVolume(
            date=datetime.fromisoformat(d).date(),
            inbound=counts["inbound"],
            outbound=counts["outbound"],
        )
        for d, counts in sorted(daily_map.items())
    ]

    # 3. CRM metrics
    new_contacts = (
        await db.scalar(
            select(func.count(Contact.id)).where(
                Contact.organization_id == org_id,
                Contact.deleted_at.is_(None),
                Contact.created_at >= start_dt,
                Contact.created_at <= end_dt,
            )
        )
        or 0
    )

    lead_stage_rows = await db.execute(
        select(
            Lead.stage,
            func.count(Lead.id),
            func.coalesce(func.sum(Lead.value_amount), 0),
        )
        .where(Lead.organization_id == org_id)
        .group_by(Lead.stage)
    )
    leads_by_stage = [
        LeadStageStat(
            stage=stage,
            count=cnt,
            total_value=float(val),
        ).model_dump()
        for stage, cnt, val in lead_stage_rows.all()
    ]

    converted_count = sum(s["count"] for s in leads_by_stage if s["stage"] == "CONVERTED")
    lost_count = sum(s["count"] for s in leads_by_stage if s["stage"] == "LOST")
    closed_total = converted_count + lost_count
    conversion_rate = (converted_count / closed_total * 100.0) if closed_total > 0 else None

    task_counts = (
        await db.execute(
            select(
                func.count(FollowUpTask.id),
                func.count(case((FollowUpTask.completed_at.is_not(None), 1))),
                func.count(
                    case(
                        (
                            and_(
                                FollowUpTask.completed_at.is_(None),
                                FollowUpTask.due_at < datetime.now(UTC),
                            ),
                            1,
                        )
                    )
                ),
            ).where(
                FollowUpTask.organization_id == org_id,
                FollowUpTask.created_at >= start_dt,
                FollowUpTask.created_at <= end_dt,
            )
        )
    ).first()
    tasks_stat = {
        "total": task_counts[0] if task_counts else 0,
        "completed": task_counts[1] if task_counts else 0,
        "overdue": task_counts[2] if task_counts else 0,
    }

    # 4. Workflows metrics
    wf_counts = (
        await db.execute(
            select(
                func.count(WorkflowRun.id),
                func.count(case((WorkflowRun.status == "COMPLETED", 1))),
                func.count(case((WorkflowRun.status.in_(("FAILED", "TIMED_OUT")), 1))),
            ).where(
                WorkflowRun.organization_id == org_id,
                WorkflowRun.is_test.is_(False),
                WorkflowRun.created_at >= start_dt,
                WorkflowRun.created_at <= end_dt,
            )
        )
    ).first()
    total_runs = wf_counts[0] if wf_counts else 0
    comp_runs = wf_counts[1] if wf_counts else 0
    fail_runs = wf_counts[2] if wf_counts else 0
    wf_fin = comp_runs + fail_runs
    success_rate = (comp_runs / wf_fin * 100.0) if wf_fin > 0 else (100.0 if total_runs > 0 else None)

    # Top failing steps
    fail_steps_rows = await db.execute(
        select(
            NodeRun.node_type,
            NodeRun.node_id,
            func.count(NodeRun.id).label("cnt"),
            func.max(NodeRun.error),
        )
        .where(
            NodeRun.organization_id == org_id,
            NodeRun.status == "failed",
            NodeRun.created_at >= start_dt,
            NodeRun.created_at <= end_dt,
        )
        .group_by(NodeRun.node_type, NodeRun.node_id)
        .order_by(func.count(NodeRun.id).desc())
        .limit(5)
    )
    top_failing_steps = [
        TopFailingStep(
            node_type=nt,
            node_id=nid,
            failure_count=cnt,
            last_error=err,
        ).model_dump()
        for nt, nid, cnt, err in fail_steps_rows.all()
    ]

    return AnalyticsDataOut(
        from_date=start_dt,
        to_date=end_dt,
        range=range_str,
        overview=overview,
        conversations={
            "new": overview.new_conversations,
            "resolved": resolved_count,
            "avg_response_time_seconds": overview.avg_response_time_seconds,
            "by_channel": by_channel,
            "by_agent": by_agent,
        },
        messages=daily_messages,
        crm={
            "new_contacts": new_contacts,
            "leads_by_stage": leads_by_stage,
            "conversion_rate": conversion_rate,
            "tasks": tasks_stat,
        },
        workflows={
            "total_runs": total_runs,
            "completed_runs": comp_runs,
            "failed_runs": fail_runs,
            "success_rate": success_rate,
            "top_failing_steps": top_failing_steps,
        },
    )


async def _calculate_avg_response_time(
    db: AsyncSession,
    org_id: uuid.UUID,
    start_dt: datetime,
    end_dt: datetime,
) -> float | None:
    # Fetch recent conversations that have messages in range
    conv_ids = (
        (
            await db.execute(
                select(Conversation.id)
                .where(
                    Conversation.organization_id == org_id,
                    Conversation.created_at >= start_dt,
                    Conversation.created_at <= end_dt,
                )
                .limit(200)
            )
        )
        .scalars()
        .all()
    )
    if not conv_ids:
        return None

    msg_rows = (
        await db.execute(
            select(Message.conversation_id, Message.direction, Message.created_at)
            .where(Message.conversation_id.in_(conv_ids))
            .order_by(Message.conversation_id, Message.created_at.asc())
        )
    ).all()

    first_in: dict[uuid.UUID, datetime] = {}
    first_out: dict[uuid.UUID, datetime] = {}
    for cid, direction, created_at in msg_rows:
        if direction == "inbound" and cid not in first_in:
            first_in[cid] = created_at
        elif direction == "outbound" and cid in first_in and cid not in first_out:
            first_out[cid] = created_at

    diffs = [
        (first_out[cid] - first_in[cid]).total_seconds()
        for cid in first_out
        if first_out[cid] >= first_in[cid]
    ]
    if not diffs:
        return None
    return round(sum(diffs) / len(diffs), 1)


async def export_csv(
    db: AsyncSession,
    org_id: uuid.UUID,
    export_type: str = "conversations",
    range_str: str = "30d",
) -> str:
    org = await db.get(Organization, org_id)
    tz_str = org.timezone if org else "UTC"
    start_dt, end_dt = _resolve_timeframe(tz_str, range_str)
    tz = ZoneInfo(tz_str)

    output = io.StringIO()
    writer = csv.writer(output)

    if export_type == "conversations":
        writer.writerow(["ID", "Contact Phone", "Status", "Priority", "Created At", "Resolved At"])
        rows = (
            await db.execute(
                select(
                    Conversation.id,
                    Contact.phone_number,
                    Conversation.status,
                    Conversation.priority,
                    Conversation.created_at,
                    Conversation.resolved_at,
                )
                .join(Contact, Contact.id == Conversation.contact_id)
                .where(
                    Conversation.organization_id == org_id,
                    Conversation.created_at >= start_dt,
                    Conversation.created_at <= end_dt,
                )
                .order_by(Conversation.created_at.desc())
            )
        ).all()
        for cid, phone, status, prio, created, resolved in rows:
            writer.writerow(
                [
                    str(cid),
                    phone or "",
                    status,
                    prio,
                    created.astimezone(tz).isoformat() if created else "",
                    resolved.astimezone(tz).isoformat() if resolved else "",
                ]
            )

    elif export_type == "messages":
        writer.writerow(["ID", "Direction", "Type", "Status", "Content Preview", "Created At"])
        rows = (
            await db.execute(
                select(
                    Message.id,
                    Message.direction,
                    Message.message_type,
                    Message.status,
                    func.substr(Message.content, 1, 100),
                    Message.created_at,
                )
                .where(
                    Message.organization_id == org_id,
                    Message.created_at >= start_dt,
                    Message.created_at <= end_dt,
                )
                .order_by(Message.created_at.desc())
            )
        ).all()
        for mid, direction, mtype, status, content, created in rows:
            writer.writerow(
                [
                    str(mid),
                    direction,
                    mtype,
                    status,
                    content or "",
                    created.astimezone(tz).isoformat() if created else "",
                ]
            )

    elif export_type == "leads":
        writer.writerow(["ID", "Title", "Stage", "Value", "Currency", "Source", "Created At", "Closed At"])
        rows = (
            await db.execute(
                select(
                    Lead.id,
                    Lead.title,
                    Lead.stage,
                    Lead.value_amount,
                    Lead.currency,
                    Lead.source,
                    Lead.created_at,
                    Lead.closed_at,
                )
                .where(
                    Lead.organization_id == org_id,
                    Lead.created_at >= start_dt,
                    Lead.created_at <= end_dt,
                )
                .order_by(Lead.created_at.desc())
            )
        ).all()
        for lid, title, stage, val, curr, src, created, closed in rows:
            writer.writerow(
                [
                    str(lid),
                    title,
                    stage,
                    f"{val:.2f}" if val is not None else "0.00",
                    curr,
                    src or "",
                    created.astimezone(tz).isoformat() if created else "",
                    closed.astimezone(tz).isoformat() if closed else "",
                ]
            )

    elif export_type == "workflows":
        writer.writerow(["ID", "Workflow ID", "Trigger Type", "Status", "Started At", "Finished At", "Error"])
        rows = (
            await db.execute(
                select(
                    WorkflowRun.id,
                    WorkflowRun.workflow_id,
                    WorkflowRun.trigger_type,
                    WorkflowRun.status,
                    WorkflowRun.created_at,
                    WorkflowRun.finished_at,
                    WorkflowRun.error,
                )
                .where(
                    WorkflowRun.organization_id == org_id,
                    WorkflowRun.created_at >= start_dt,
                    WorkflowRun.created_at <= end_dt,
                )
                .order_by(WorkflowRun.created_at.desc())
            )
        ).all()
        for rid, wfid, ttype, status, created, fin, err in rows:
            writer.writerow(
                [
                    str(rid),
                    str(wfid),
                    ttype,
                    status,
                    created.astimezone(tz).isoformat() if created else "",
                    fin.astimezone(tz).isoformat() if fin else "",
                    err or "",
                ]
            )

    return output.getvalue()
