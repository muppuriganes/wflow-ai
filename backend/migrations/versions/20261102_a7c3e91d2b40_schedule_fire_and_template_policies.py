"""schedule_fire_and_template_policies

Scheduled fires arrive from Temporal before any tenant context exists, so the worker needs a narrow
owner-privileged lookup from schedule id to organization. System templates are shared read-only:
the previous single FOR ALL policy let any organization delete or rewrite them at the database level.

Revision ID: a7c3e91d2b40
Revises: f20322ac438c
Create Date: 2026-11-02 18:10:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "a7c3e91d2b40"
down_revision: str | None = "f20322ac438c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION schedule_org_by_id(p_id uuid)
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT organization_id FROM schedules WHERE id = p_id
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION schedule_org_by_id(uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION schedule_org_by_id(uuid) TO wflow_app")

    op.execute("DROP POLICY IF EXISTS workflow_templates_tenant ON workflow_templates")
    op.execute(
        "CREATE POLICY workflow_templates_read ON workflow_templates FOR SELECT "
        "USING (is_system = true OR organization_id = app_current_org_id())"
    )
    op.execute(
        "CREATE POLICY workflow_templates_write ON workflow_templates FOR ALL "
        "USING (is_system = false AND organization_id = app_current_org_id()) "
        "WITH CHECK (is_system = false AND organization_id = app_current_org_id())"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS workflow_templates_write ON workflow_templates")
    op.execute("DROP POLICY IF EXISTS workflow_templates_read ON workflow_templates")
    op.execute(
        "CREATE POLICY workflow_templates_tenant ON workflow_templates FOR ALL "
        "USING (is_system = true OR organization_id = app_current_org_id()) "
        "WITH CHECK (is_system = false AND organization_id = app_current_org_id())"
    )
    op.execute("DROP FUNCTION IF EXISTS schedule_org_by_id(uuid)")
