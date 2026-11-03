"""platform_stats_trends

Richer counts for the Super Admin dashboard: per-day inbound/outbound messages, workflow runs and
sign-ups (grouped in one pass instead of a query per day), plus the previous period's totals so the
cards can show real trends. Still counts only, still Super Admin only.

Revision ID: e5b8c3d0f926
Revises: d4a7b2c9e815
Create Date: 2026-11-03 12:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "e5b8c3d0f926"
down_revision: str | None = "d4a7b2c9e815"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FUNCTION = """
CREATE OR REPLACE FUNCTION platform_stats(p_since timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p_prev timestamptz := p_since - (now() - p_since);
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
    'organizations_new', (SELECT count(*) FROM organizations WHERE deleted_at IS NULL AND created_at >= p_since),
    'organizations_new_prev', (SELECT count(*) FROM organizations
                               WHERE deleted_at IS NULL AND created_at >= p_prev AND created_at < p_since),
    'organizations_active', (SELECT count(DISTINCT organization_id) FROM messages WHERE created_at >= p_since),
    'organizations_active_prev', (SELECT count(DISTINCT organization_id) FROM messages
                                  WHERE created_at >= p_prev AND created_at < p_since),
    'users_total', (SELECT count(*) FROM users),
    'users_new', (SELECT count(*) FROM users WHERE created_at >= p_since),
    'users_new_prev', (SELECT count(*) FROM users WHERE created_at >= p_prev AND created_at < p_since),
    'channels_connected', (SELECT count(*) FROM channel_connections WHERE deleted_at IS NULL AND status = 'CONNECTED'),
    'channels_total', (SELECT count(*) FROM channel_connections WHERE deleted_at IS NULL),
    'messages_in', (SELECT count(*) FROM messages WHERE created_at >= p_since AND direction = 'inbound'),
    'messages_out', (SELECT count(*) FROM messages WHERE created_at >= p_since AND direction = 'outbound'),
    'messages_prev', (SELECT count(*) FROM messages WHERE created_at >= p_prev AND created_at < p_since),
    'workflow_runs', (SELECT count(*) FROM workflow_runs WHERE created_at >= p_since AND NOT is_test),
    'workflow_runs_failed', (SELECT count(*) FROM workflow_runs
                             WHERE created_at >= p_since AND NOT is_test AND status IN ('FAILED', 'TIMED_OUT')),
    'workflow_runs_prev', (SELECT count(*) FROM workflow_runs
                           WHERE created_at >= p_prev AND created_at < p_since AND NOT is_test),
    'revenue_cents', (SELECT coalesce(sum(amount_cents), 0) FROM invoices WHERE status = 'paid' AND created_at >= p_since),
    'revenue_cents_prev', (SELECT coalesce(sum(amount_cents), 0) FROM invoices
                           WHERE status = 'paid' AND created_at >= p_prev AND created_at < p_since),
    'daily', (
      WITH days AS (
        SELECT day::date AS day
        FROM generate_series(date_trunc('day', p_since), date_trunc('day', now()), interval '1 day') AS day
      ),
      msg AS (
        SELECT created_at::date AS day, count(*) FILTER (WHERE direction = 'inbound') AS inbound,
               count(*) FILTER (WHERE direction = 'outbound') AS outbound
        FROM messages WHERE created_at >= date_trunc('day', p_since) GROUP BY 1
      ),
      runs AS (
        SELECT created_at::date AS day, count(*) AS runs, count(*) FILTER (WHERE status IN ('FAILED', 'TIMED_OUT')) AS failed
        FROM workflow_runs WHERE created_at >= date_trunc('day', p_since) AND NOT is_test GROUP BY 1
      ),
      orgs AS (
        SELECT created_at::date AS day, count(*) AS signups
        FROM organizations WHERE created_at >= date_trunc('day', p_since) AND deleted_at IS NULL GROUP BY 1
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'day', d.day,
               'inbound', coalesce(m.inbound, 0), 'outbound', coalesce(m.outbound, 0),
               'messages', coalesce(m.inbound, 0) + coalesce(m.outbound, 0),
               'runs', coalesce(r.runs, 0), 'runs_failed', coalesce(r.failed, 0),
               'signups', coalesce(o.signups, 0)) ORDER BY d.day), '[]'::jsonb)
      FROM days d
      LEFT JOIN msg m ON m.day = d.day LEFT JOIN runs r ON r.day = d.day LEFT JOIN orgs o ON o.day = d.day
    )
  );
END $$
"""


def upgrade() -> None:
    op.execute(FUNCTION)


def downgrade() -> None:
    # The previous definition stays valid: callers only read keys it also returns.
    pass
