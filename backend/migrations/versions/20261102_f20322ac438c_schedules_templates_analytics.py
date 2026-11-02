"""schedules_templates_analytics

Revision ID: f20322ac438c
Revises: 6366a0836906
Create Date: 2026-11-02 15:40:13.533327
"""

import json
import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f20322ac438c"
down_revision: str | None = "6366a0836906"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 1. Schedules table
    op.create_table(
        "schedules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("workflow_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
        sa.Column("schedule_type", sa.String(length=20), server_default="daily", nullable=False),
        sa.Column("config", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("timezone", sa.String(length=50), server_default="UTC", nullable=False),
        sa.Column("target_tag_id", sa.Uuid(), nullable=True),
        sa.Column("temporal_schedule_id", sa.String(length=100), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("total_runs", sa.Integer(), server_default="0", nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_schedules_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_schedules_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["workflow_id"],
            ["workflows.id"],
            name=op.f("fk_schedules_workflow_id_workflows"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["target_tag_id"],
            ["tags.id"],
            name=op.f("fk_schedules_target_tag_id_tags"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_schedules")),
        sa.UniqueConstraint("temporal_schedule_id", name=op.f("uq_schedules_temporal_schedule_id")),
    )
    op.create_index("ix_schedules_org_status", "schedules", ["organization_id", "status"], unique=False)
    op.create_index("ix_schedules_workflow", "schedules", ["workflow_id"], unique=False)

    # 2. Workflow templates table
    op.create_table(
        "workflow_templates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("category", sa.String(length=50), server_default="General", nullable=False),
        sa.Column("definition", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("is_system", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            name=op.f("fk_workflow_templates_created_by_user_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            name=op.f("fk_workflow_templates_organization_id_organizations"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_workflow_templates")),
    )
    op.create_index("ix_workflow_templates_category", "workflow_templates", ["category"], unique=False)
    op.create_index("ix_workflow_templates_org", "workflow_templates", ["organization_id"], unique=False)

    # 3. Performance indexes for Analytics
    op.create_index("ix_messages_org_created", "messages", ["organization_id", "created_at"], unique=False)
    op.create_index(
        "ix_conversations_org_created", "conversations", ["organization_id", "created_at"], unique=False
    )
    op.create_index("ix_leads_org_created", "leads", ["organization_id", "created_at"], unique=False)
    op.create_index("ix_contacts_org_created", "contacts", ["organization_id", "created_at"], unique=False)
    op.create_index(
        "ix_follow_up_tasks_org_created", "follow_up_tasks", ["organization_id", "created_at"], unique=False
    )

    # 4. Row Level Security
    op.execute("ALTER TABLE schedules ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY schedules_tenant ON schedules FOR ALL "
        "USING (organization_id = app_current_org_id()) "
        "WITH CHECK (organization_id = app_current_org_id())"
    )

    op.execute("ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY workflow_templates_tenant ON workflow_templates FOR ALL "
        "USING (is_system = true OR organization_id = app_current_org_id()) "
        "WITH CHECK (is_system = false AND organization_id = app_current_org_id())"
    )

    # 5. Seed 5 system starter templates
    seed_templates(op)


def seed_templates(op_ctx) -> None:
    templates = [
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000001"),
            "name": "Keyword auto-reply",
            "category": "Customer Support",
            "description": "Automatically send a tailored answer whenever a customer asks about pricing or plans.",
            "definition": {
                "nodes": [
                    {
                        "id": "node_trigger",
                        "position": {"x": 250, "y": 50},
                        "data": {
                            "nodeType": "trigger.message_received",
                            "config": {"keywords": ["pricing", "plans", "quote"], "match": "any"},
                        },
                    },
                    {
                        "id": "node_reply",
                        "position": {"x": 250, "y": 200},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Hi {{contact.name}}! Thank you for inquiring about our pricing. Our packages start from $29/mo with full WhatsApp integration. Would you like us to schedule a demo?"
                            },
                        },
                    },
                    {
                        "id": "node_status",
                        "position": {"x": 250, "y": 350},
                        "data": {
                            "nodeType": "action.set_status",
                            "config": {"status": "PENDING"},
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node_trigger", "sourceHandle": "out", "target": "node_reply"},
                    {"id": "e2", "source": "node_reply", "sourceHandle": "out", "target": "node_status"},
                ],
            },
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000002"),
            "name": "Out-of-hours reply",
            "category": "Customer Support",
            "description": "Check if your office is currently open; if closed, send an automated away message to manage expectations.",
            "definition": {
                "nodes": [
                    {
                        "id": "node_trigger",
                        "position": {"x": 250, "y": 50},
                        "data": {
                            "nodeType": "trigger.message_received",
                            "config": {},
                        },
                    },
                    {
                        "id": "node_hours",
                        "position": {"x": 250, "y": 200},
                        "data": {
                            "nodeType": "condition.business_hours",
                            "config": {
                                "days": ["mon", "tue", "wed", "thu", "fri"],
                                "start": "09:00",
                                "end": "18:00",
                            },
                        },
                    },
                    {
                        "id": "node_away_msg",
                        "position": {"x": 400, "y": 350},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Hello {{contact.name}}! Thanks for reaching out. Our offices are currently closed. We are available Mon-Fri, 9am - 6pm and will get back to you as soon as we open."
                            },
                        },
                    },
                    {
                        "id": "node_stop",
                        "position": {"x": 250, "y": 500},
                        "data": {
                            "nodeType": "logic.stop",
                            "config": {},
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node_trigger", "sourceHandle": "out", "target": "node_hours"},
                    {"id": "e2", "source": "node_hours", "sourceHandle": "false", "target": "node_away_msg"},
                    {"id": "e3", "source": "node_away_msg", "sourceHandle": "out", "target": "node_stop"},
                    {"id": "e4", "source": "node_hours", "sourceHandle": "true", "target": "node_stop"},
                ],
            },
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000003"),
            "name": "New-lead capture",
            "category": "Sales & Leads",
            "description": "Automatically create a pipeline lead from new contacts, greet them, and create an onboarding task.",
            "definition": {
                "nodes": [
                    {
                        "id": "node_trigger",
                        "position": {"x": 250, "y": 50},
                        "data": {
                            "nodeType": "trigger.new_contact",
                            "config": {},
                        },
                    },
                    {
                        "id": "node_lead",
                        "position": {"x": 250, "y": 200},
                        "data": {
                            "nodeType": "action.create_lead",
                            "config": {
                                "title": "Inquiry: {{contact.name}}",
                                "stage": "NEW",
                                "source": "whatsapp",
                            },
                        },
                    },
                    {
                        "id": "node_msg",
                        "position": {"x": 250, "y": 350},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Welcome to WFlow AI, {{contact.name}}! We are thrilled to connect with you. A sales representative has been notified and will reach out shortly."
                            },
                        },
                    },
                    {
                        "id": "node_task",
                        "position": {"x": 250, "y": 500},
                        "data": {
                            "nodeType": "action.create_task",
                            "config": {
                                "title": "Qualify new lead {{contact.name}}",
                                "due_hours": 24,
                            },
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node_trigger", "sourceHandle": "out", "target": "node_lead"},
                    {"id": "e2", "source": "node_lead", "sourceHandle": "out", "target": "node_msg"},
                    {"id": "e3", "source": "node_msg", "sourceHandle": "out", "target": "node_task"},
                ],
            },
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000004"),
            "name": "Approval for discounts",
            "category": "Approvals",
            "description": "Request human manager approval before committing to discount offers, routing to the approvals queue.",
            "definition": {
                "nodes": [
                    {
                        "id": "node_trigger",
                        "position": {"x": 250, "y": 50},
                        "data": {
                            "nodeType": "trigger.manual",
                            "config": {},
                        },
                    },
                    {
                        "id": "node_approval",
                        "position": {"x": 250, "y": 200},
                        "data": {
                            "nodeType": "human.approval",
                            "config": {
                                "title": "Discount approval for {{contact.name}}",
                                "details": "Review customer request for special commercial pricing.",
                                "timeout_hours": 24,
                            },
                        },
                    },
                    {
                        "id": "node_approved",
                        "position": {"x": 100, "y": 350},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Great news {{contact.name}}! Your requested discount has been approved by our team. Here is your promo link: https://example.com/checkout?code=SPECIAL20"
                            },
                        },
                    },
                    {
                        "id": "node_rejected",
                        "position": {"x": 400, "y": 350},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Hi {{contact.name}}, unfortunately we cannot offer that discount rate at this time, but we can offer 5% on an annual commitment."
                            },
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node_trigger", "sourceHandle": "out", "target": "node_approval"},
                    {
                        "id": "e2",
                        "source": "node_approval",
                        "sourceHandle": "approved",
                        "target": "node_approved",
                    },
                    {
                        "id": "e3",
                        "source": "node_approval",
                        "sourceHandle": "rejected",
                        "target": "node_rejected",
                    },
                ],
            },
        },
        {
            "id": uuid.UUID("00000000-0000-0000-0000-000000000005"),
            "name": "Follow-up after no reply",
            "category": "Re-engagement",
            "description": "Wait up to 2 days for customer reply on a proposal, sending a friendly follow-up nudge if they don't respond.",
            "definition": {
                "nodes": [
                    {
                        "id": "node_trigger",
                        "position": {"x": 250, "y": 50},
                        "data": {
                            "nodeType": "trigger.message_received",
                            "config": {"keywords": ["demo", "proposal", "info"], "match": "any"},
                        },
                    },
                    {
                        "id": "node_initial",
                        "position": {"x": 250, "y": 200},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Hi {{contact.name}}, thanks for your interest! Here is the overview you requested. Let us know if you have any questions."
                            },
                        },
                    },
                    {
                        "id": "node_wait",
                        "position": {"x": 250, "y": 350},
                        "data": {
                            "nodeType": "logic.wait_for_reply",
                            "config": {"timeout_value": 2, "timeout_unit": "days"},
                        },
                    },
                    {
                        "id": "node_nudge",
                        "position": {"x": 400, "y": 500},
                        "data": {
                            "nodeType": "action.send_message",
                            "config": {
                                "text": "Hi {{contact.name}}, just following up to make sure you received our previous message. Would you like to schedule a quick 10-minute demo?"
                            },
                        },
                    },
                    {
                        "id": "node_replied",
                        "position": {"x": 100, "y": 500},
                        "data": {
                            "nodeType": "action.set_status",
                            "config": {"status": "OPEN"},
                        },
                    },
                ],
                "edges": [
                    {"id": "e1", "source": "node_trigger", "sourceHandle": "out", "target": "node_initial"},
                    {"id": "e2", "source": "node_initial", "sourceHandle": "out", "target": "node_wait"},
                    {"id": "e3", "source": "node_wait", "sourceHandle": "timeout", "target": "node_nudge"},
                    {"id": "e4", "source": "node_wait", "sourceHandle": "replied", "target": "node_replied"},
                ],
            },
        },
    ]

    for t in templates:
        op_ctx.execute(
            sa.text(
                "INSERT INTO workflow_templates (id, organization_id, name, description, category, definition, is_system, created_at, updated_at) "
                "VALUES (:id, NULL, :name, :description, :category, CAST(:definition AS jsonb), true, now(), now()) "
                "ON CONFLICT (id) DO NOTHING"
            ).bindparams(
                id=t["id"],
                name=t["name"],
                description=t["description"],
                category=t["category"],
                definition=json.dumps(t["definition"]),
            )
        )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS workflow_templates_tenant ON workflow_templates")
    op.execute("DROP POLICY IF EXISTS schedules_tenant ON schedules")

    op.drop_index("ix_follow_up_tasks_org_created", table_name="follow_up_tasks")
    op.drop_index("ix_contacts_org_created", table_name="contacts")
    op.drop_index("ix_leads_org_created", table_name="leads")
    op.drop_index("ix_conversations_org_created", table_name="conversations")
    op.drop_index("ix_messages_org_created", table_name="messages")

    op.drop_index("ix_workflow_templates_org", table_name="workflow_templates")
    op.drop_index("ix_workflow_templates_category", table_name="workflow_templates")
    op.drop_table("workflow_templates")

    op.drop_index("ix_schedules_workflow", table_name="schedules")
    op.drop_index("ix_schedules_org_status", table_name="schedules")
    op.drop_table("schedules")
