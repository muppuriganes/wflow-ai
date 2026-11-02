"""platform_governance

Organization approval (sign-up requests reviewed by a Super Admin), per-organization billing switch,
owner-granted support access, and counts-only platform statistics for the Super Admin console.

Revision ID: d4a7b2c9e815
Revises: c9e5f2a4b36d
Create Date: 2026-11-03 09:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d4a7b2c9e815"
down_revision: str | None = "c9e5f2a4b36d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Existing organizations are approved and keep working without a payment requirement.
    op.add_column("organizations", sa.Column("approval_status", sa.String(16), nullable=False,
                                             server_default="approved"))  # fmt: skip
    op.add_column("organizations", sa.Column("request_details", postgresql.JSONB(), nullable=False,
                                             server_default="{}"))  # fmt: skip
    op.add_column("organizations", sa.Column("reviewed_by_user_id", sa.Uuid(), nullable=True))
    op.add_column("organizations", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("organizations", sa.Column("rejection_reason", sa.String(500), nullable=True))
    op.add_column("organizations", sa.Column("billing_required", sa.Boolean(), nullable=False,
                                             server_default=sa.text("false")))  # fmt: skip
    op.add_column(
        "organizations", sa.Column("support_access_until", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_foreign_key("fk_organizations_reviewed_by_user_id_users", "organizations", "users",
                          ["reviewed_by_user_id"], ["id"], ondelete="SET NULL")  # fmt: skip
    op.create_index("ix_organizations_approval_status", "organizations", ["approval_status"])

    # The console shows each organization's invoices.
    op.execute(
        "CREATE POLICY invoices_superadmin_select ON invoices FOR SELECT USING (app_current_user_is_superadmin())"
    )

    # A Super Admin opens a workspace only while its owner allows support access.
    op.execute(
        """
        CREATE FUNCTION org_support_access_until(p_org uuid) RETURNS timestamptz
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT support_access_until FROM organizations WHERE id = p_org AND deleted_at IS NULL $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION support_access_orgs() RETURNS TABLE (id uuid)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
        $$ SELECT id FROM organizations
           WHERE app_current_user_is_superadmin() AND deleted_at IS NULL AND support_access_until > now() $$
        """
    )

    # Counts only, never content; refuses anyone but a Super Admin.
    op.execute(
        """
        CREATE FUNCTION platform_stats(p_since timestamptz) RETURNS jsonb
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
        BEGIN
          IF NOT app_current_user_is_superadmin() THEN
            RAISE EXCEPTION 'platform_stats: Super Admin only' USING ERRCODE = '42501';
          END IF;
          RETURN jsonb_build_object(
            'organizations_total', (SELECT count(*) FROM organizations WHERE deleted_at IS NULL),
            'organizations_pending', (SELECT count(*) FROM organizations
                                      WHERE deleted_at IS NULL AND approval_status = 'pending'),
            'organizations_suspended', (SELECT count(*) FROM organizations
                                        WHERE deleted_at IS NULL AND status = 'suspended'),
            'organizations_new', (SELECT count(*) FROM organizations
                                  WHERE deleted_at IS NULL AND created_at >= p_since),
            'organizations_active', (SELECT count(DISTINCT organization_id) FROM messages WHERE created_at >= p_since),
            'users_total', (SELECT count(*) FROM users),
            'users_new', (SELECT count(*) FROM users WHERE created_at >= p_since),
            'channels_connected', (SELECT count(*) FROM channel_connections
                                   WHERE deleted_at IS NULL AND status = 'CONNECTED'),
            'messages_in', (SELECT count(*) FROM messages WHERE created_at >= p_since AND direction = 'inbound'),
            'messages_out', (SELECT count(*) FROM messages WHERE created_at >= p_since AND direction = 'outbound'),
            'workflow_runs', (SELECT count(*) FROM workflow_runs WHERE created_at >= p_since AND NOT is_test),
            'workflow_runs_failed', (SELECT count(*) FROM workflow_runs
                                     WHERE created_at >= p_since AND NOT is_test AND status IN ('FAILED', 'TIMED_OUT')),
            'revenue_cents', (SELECT coalesce(sum(amount_cents), 0) FROM invoices
                              WHERE status = 'paid' AND created_at >= p_since),
            'daily', (
              SELECT coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'messages', d.messages,
                                                           'signups', d.signups) ORDER BY d.day), '[]'::jsonb)
              FROM (
                SELECT day::date AS day,
                       (SELECT count(*) FROM messages m WHERE m.created_at >= day AND m.created_at < day + interval '1 day') AS messages,
                       (SELECT count(*) FROM organizations o WHERE o.created_at >= day AND o.created_at < day + interval '1 day') AS signups
                FROM generate_series(date_trunc('day', p_since), date_trunc('day', now()), interval '1 day') AS day
              ) d
            )
          );
        END $$
        """
    )
    op.execute(
        """
        CREATE FUNCTION org_activity_stats(p_since timestamptz)
        RETURNS TABLE (organization_id uuid, contacts bigint, conversations bigint, messages_in bigint,
                       messages_out bigint, workflow_runs bigint, workflow_runs_failed bigint,
                       last_activity_at timestamptz)
        LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
        BEGIN
          IF NOT app_current_user_is_superadmin() THEN
            RAISE EXCEPTION 'org_activity_stats: Super Admin only' USING ERRCODE = '42501';
          END IF;
          RETURN QUERY
          SELECT o.id,
                 (SELECT count(*) FROM contacts c WHERE c.organization_id = o.id AND c.deleted_at IS NULL),
                 (SELECT count(*) FROM conversations v WHERE v.organization_id = o.id),
                 (SELECT count(*) FROM messages m WHERE m.organization_id = o.id AND m.created_at >= p_since
                    AND m.direction = 'inbound'),
                 (SELECT count(*) FROM messages m WHERE m.organization_id = o.id AND m.created_at >= p_since
                    AND m.direction = 'outbound'),
                 (SELECT count(*) FROM workflow_runs r WHERE r.organization_id = o.id AND r.created_at >= p_since
                    AND NOT r.is_test),
                 (SELECT count(*) FROM workflow_runs r WHERE r.organization_id = o.id AND r.created_at >= p_since
                    AND NOT r.is_test AND r.status IN ('FAILED', 'TIMED_OUT')),
                 (SELECT max(m.created_at) FROM messages m WHERE m.organization_id = o.id)
          FROM organizations o WHERE o.deleted_at IS NULL;
        END $$
        """
    )
    for fn in ("org_support_access_until(uuid)", "support_access_orgs()", "platform_stats(timestamptz)",
               "org_activity_stats(timestamptz)"):  # fmt: skip
        op.execute(f"REVOKE ALL ON FUNCTION {fn} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {fn} TO wflow_app")


def downgrade() -> None:
    for fn in ("org_activity_stats(timestamptz)", "platform_stats(timestamptz)", "support_access_orgs()",
               "org_support_access_until(uuid)"):  # fmt: skip
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")
    op.execute("DROP POLICY IF EXISTS invoices_superadmin_select ON invoices")
    op.drop_index("ix_organizations_approval_status", table_name="organizations")
    op.drop_constraint("fk_organizations_reviewed_by_user_id_users", "organizations", type_="foreignkey")
    for col in ("support_access_until", "billing_required", "rejection_reason", "reviewed_at",
                "reviewed_by_user_id", "request_details", "approval_status"):  # fmt: skip
        op.drop_column("organizations", col)
