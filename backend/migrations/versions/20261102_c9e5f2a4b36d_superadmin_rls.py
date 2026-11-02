"""Superadmin RLS policies and helper function.

Revision ID: c9e5f2a4b36d
Revises: b8d4e1f3a25c
Create Date: 2026-11-02 18:00:00.000000
"""

import sqlalchemy as sa
from alembic import op

revision = "c9e5f2a4b36d"
down_revision = "b8d4e1f3a25c"
branch_labels = None
depends_on = None


UP_STATEMENTS = [
    """
    CREATE FUNCTION app_current_user_is_superadmin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
    $$ SELECT coalesce((SELECT is_superadmin FROM users WHERE id = app_current_user_id()), false) $$;
    """,
    "GRANT EXECUTE ON FUNCTION app_current_user_is_superadmin() TO wflow_app",
    """
    CREATE FUNCTION org_id_by_stripe_customer_or_sub(p_cust text, p_sub text) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
    $$ SELECT organization_id FROM subscriptions
       WHERE (p_sub IS NOT NULL AND provider_subscription_id = p_sub)
          OR (p_cust IS NOT NULL AND provider_customer_id = p_cust)
       LIMIT 1 $$;
    """,
    "GRANT EXECUTE ON FUNCTION org_id_by_stripe_customer_or_sub(text, text) TO wflow_app",
    "CREATE POLICY organizations_superadmin_select ON organizations FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY organizations_superadmin_update ON organizations FOR UPDATE USING (app_current_user_is_superadmin()) WITH CHECK (app_current_user_is_superadmin())",
    "CREATE POLICY subscriptions_superadmin_select ON subscriptions FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY subscriptions_superadmin_update ON subscriptions FOR UPDATE USING (app_current_user_is_superadmin()) WITH CHECK (app_current_user_is_superadmin())",
    "CREATE POLICY usage_counters_superadmin_select ON usage_counters FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY members_superadmin_select ON organization_members FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY workflows_superadmin_select ON workflows FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY connections_superadmin_select ON channel_connections FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY audit_superadmin_select ON audit_logs FOR SELECT USING (app_current_user_is_superadmin())",
    "CREATE POLICY audit_superadmin_insert ON audit_logs FOR INSERT WITH CHECK (app_current_user_is_superadmin())",
]

DOWN_STATEMENTS = [
    "DROP FUNCTION IF EXISTS org_id_by_stripe_customer_or_sub(text, text)",
    "DROP POLICY IF EXISTS audit_superadmin_insert ON audit_logs",
    "DROP POLICY IF EXISTS audit_superadmin_select ON audit_logs",
    "DROP POLICY IF EXISTS connections_superadmin_select ON channel_connections",
    "DROP POLICY IF EXISTS workflows_superadmin_select ON workflows",
    "DROP POLICY IF EXISTS members_superadmin_select ON organization_members",
    "DROP POLICY IF EXISTS usage_counters_superadmin_select ON usage_counters",
    "DROP POLICY IF EXISTS subscriptions_superadmin_update ON subscriptions",
    "DROP POLICY IF EXISTS subscriptions_superadmin_select ON subscriptions",
    "DROP POLICY IF EXISTS organizations_superadmin_update ON organizations",
    "DROP POLICY IF EXISTS organizations_superadmin_select ON organizations",
    "DROP FUNCTION IF EXISTS app_current_user_is_superadmin()",
]


def upgrade() -> None:
    for stmt in UP_STATEMENTS:
        op.execute(sa.text(stmt.strip()))


def downgrade() -> None:
    for stmt in DOWN_STATEMENTS:
        op.execute(sa.text(stmt.strip()))
