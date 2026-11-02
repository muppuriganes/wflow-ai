"""commercial_platform

M6: Plans, subscriptions, usage metering, billing foundation, outgoing webhooks,
integration credentials, organization suspension, and SECURITY DEFINER helpers.

Revision ID: b8d4e1f3a25c
Revises: a7c3e91d2b40
Create Date: 2026-11-02 19:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "b8d4e1f3a25c"
down_revision: str | None = "a7c3e91d2b40"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def exec_sql(sql_block: str) -> None:
    for stmt in sql_block.split(";"):
        cleaned = stmt.strip()
        if cleaned:
            op.execute(cleaned)


def upgrade() -> None:
    # 1. Organization suspension columns
    exec_sql(
        """
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status varchar(32) NOT NULL DEFAULT 'active';
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at timestamptz NULL;
        ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_reason varchar(255) NULL;
        """
    )

    # 2. Plans table (global, shared across all organizations)
    exec_sql(
        """
        CREATE TABLE plans (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            key varchar(50) NOT NULL UNIQUE,
            name varchar(100) NOT NULL,
            description varchar(255) NOT NULL DEFAULT '',
            price_cents_monthly int NOT NULL DEFAULT 0,
            price_cents_yearly int NOT NULL DEFAULT 0,
            currency varchar(10) NOT NULL DEFAULT 'usd',
            limits jsonb NOT NULL DEFAULT '{}'::jsonb,
            features jsonb NOT NULL DEFAULT '{}'::jsonb,
            is_active boolean NOT NULL DEFAULT true,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_plans_key ON plans(key);
        ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
        CREATE POLICY plans_read ON plans FOR SELECT USING (true);
        CREATE POLICY plans_write ON plans FOR ALL USING (false) WITH CHECK (false);
        GRANT SELECT ON plans TO wflow_app;
        GRANT ALL ON plans TO wflow_owner;
        """
    )

    # Seed starter plans: Free, Starter, Growth, Business
    op.execute(
        """
        INSERT INTO plans (key, name, description, price_cents_monthly, price_cents_yearly, currency, limits, features)
        VALUES
        (
            'free',
            'Free',
            'For individuals and small experiments',
            0,
            0,
            'usd',
            '{"max_members": 2, "max_channels": 1, "max_workflows": 5, "max_active_schedules": 2, "max_monthly_runs": 200, "max_monthly_messages": 500, "max_storage_mb": 250}'::jsonb,
            '{"webhooks": false, "http_request_node": false}'::jsonb
        ),
        (
            'starter',
            'Starter',
            'For growing teams automating their customer chat',
            2900,
            29000,
            'usd',
            '{"max_members": 5, "max_channels": 2, "max_workflows": 25, "max_active_schedules": 10, "max_monthly_runs": 2500, "max_monthly_messages": 5000, "max_storage_mb": 1000}'::jsonb,
            '{"webhooks": true, "http_request_node": true}'::jsonb
        ),
        (
            'growth',
            'Growth',
            'For scaling operations needing high throughput and webhooks',
            7900,
            79000,
            'usd',
            '{"max_members": 15, "max_channels": 5, "max_workflows": 100, "max_active_schedules": 50, "max_monthly_runs": 10000, "max_monthly_messages": 25000, "max_storage_mb": 5000}'::jsonb,
            '{"webhooks": true, "http_request_node": true}'::jsonb
        ),
        (
            'business',
            'Business',
            'Enterprise scale with dedicated volume and priority execution',
            19900,
            199000,
            'usd',
            '{"max_members": 50, "max_channels": 20, "max_workflows": 500, "max_active_schedules": 250, "max_monthly_runs": 50000, "max_monthly_messages": 100000, "max_storage_mb": 25000}'::jsonb,
            '{"webhooks": true, "http_request_node": true}'::jsonb
        )
        ON CONFLICT (key) DO NOTHING
        """
    )

    # 3. Subscriptions table
    exec_sql(
        """
        CREATE TABLE subscriptions (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE UNIQUE,
            plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
            status varchar(32) NOT NULL DEFAULT 'trialing',
            billing_interval varchar(16) NOT NULL DEFAULT 'monthly',
            current_period_start timestamptz NOT NULL DEFAULT now(),
            current_period_end timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
            trial_end timestamptz NULL,
            cancel_at_period_end boolean NOT NULL DEFAULT false,
            provider varchar(32) NOT NULL DEFAULT 'stripe',
            provider_customer_id varchar(255) NULL,
            provider_subscription_id varchar(255) NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_subscriptions_org ON subscriptions(organization_id);
        CREATE INDEX ix_subscriptions_plan ON subscriptions(plan_id);
        ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
        CREATE POLICY subscriptions_tenant ON subscriptions FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON subscriptions TO wflow_app, wflow_owner;
        """
    )

    # Backfill existing organizations with a 14-day trial of Growth
    op.execute(
        """
        INSERT INTO subscriptions (organization_id, plan_id, status, billing_interval, current_period_start, current_period_end, trial_end, provider)
        SELECT o.id, p.id, 'trialing', 'monthly', now(), now() + interval '14 days', now() + interval '14 days', 'stripe'
        FROM organizations o
        CROSS JOIN plans p
        WHERE p.key = 'growth'
        ON CONFLICT (organization_id) DO NOTHING
        """
    )

    # 4. Usage counters table (atomic monthly counts)
    exec_sql(
        """
        CREATE TABLE usage_counters (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            year_month varchar(7) NOT NULL,
            workflow_runs_count int NOT NULL DEFAULT 0,
            outbound_messages_count int NOT NULL DEFAULT 0,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_usage_counters_org_month UNIQUE (organization_id, year_month)
        );
        CREATE INDEX ix_usage_counters_org_month ON usage_counters(organization_id, year_month);
        ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
        CREATE POLICY usage_counters_tenant ON usage_counters FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON usage_counters TO wflow_app, wflow_owner;
        """
    )

    # 5. Invoices table
    exec_sql(
        """
        CREATE TABLE invoices (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            subscription_id uuid NULL REFERENCES subscriptions(id) ON DELETE SET NULL,
            invoice_number varchar(64) NOT NULL UNIQUE,
            amount_cents int NOT NULL,
            currency varchar(10) NOT NULL DEFAULT 'usd',
            status varchar(32) NOT NULL DEFAULT 'paid',
            period_start timestamptz NOT NULL,
            period_end timestamptz NOT NULL,
            pdf_url varchar(500) NULL,
            provider_invoice_id varchar(255) NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_invoices_org ON invoices(organization_id);
        ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
        CREATE POLICY invoices_tenant ON invoices FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON invoices TO wflow_app, wflow_owner;
        """
    )

    # 6. Processed provider events (deduplication of billing webhooks)
    exec_sql(
        """
        CREATE TABLE processed_provider_events (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            provider varchar(32) NOT NULL,
            event_id varchar(255) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_processed_provider_events UNIQUE (provider, event_id)
        );
        GRANT ALL ON processed_provider_events TO wflow_app, wflow_owner;
        """
    )

    # 7. Webhooks table (outgoing webhooks)
    exec_sql(
        """
        CREATE TABLE webhooks (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name varchar(100) NOT NULL,
            target_url varchar(1000) NOT NULL,
            secret_key varchar(128) NOT NULL,
            events jsonb NOT NULL DEFAULT '[]'::jsonb,
            is_active boolean NOT NULL DEFAULT true,
            consecutive_failures int NOT NULL DEFAULT 0,
            disabled_reason varchar(255) NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_webhooks_org ON webhooks(organization_id);
        ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
        CREATE POLICY webhooks_tenant ON webhooks FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON webhooks TO wflow_app, wflow_owner;
        """
    )

    # 8. Webhook deliveries table
    exec_sql(
        """
        CREATE TABLE webhook_deliveries (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            webhook_id uuid NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
            event_type varchar(100) NOT NULL,
            event_id varchar(64) NOT NULL,
            payload jsonb NOT NULL,
            response_status int NULL,
            response_body varchar(2000) NULL,
            duration_ms int NULL,
            attempt int NOT NULL DEFAULT 1,
            success boolean NOT NULL DEFAULT false,
            error varchar(1000) NULL,
            created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE INDEX ix_webhook_deliveries_org ON webhook_deliveries(organization_id);
        CREATE INDEX ix_webhook_deliveries_webhook_created ON webhook_deliveries(webhook_id, created_at);
        ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
        CREATE POLICY webhook_deliveries_tenant ON webhook_deliveries FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON webhook_deliveries TO wflow_app, wflow_owner;
        """
    )

    # 9. Integration credentials table
    exec_sql(
        """
        CREATE TABLE integration_credentials (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name varchar(100) NOT NULL,
            type varchar(32) NOT NULL DEFAULT 'bearer',
            encrypted_secret varchar(1000) NOT NULL,
            masked_secret varchar(64) NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT uq_integration_credentials_org_name UNIQUE (organization_id, name)
        );
        CREATE INDEX ix_integration_credentials_org ON integration_credentials(organization_id);
        ALTER TABLE integration_credentials ENABLE ROW LEVEL SECURITY;
        CREATE POLICY integration_credentials_tenant ON integration_credentials FOR ALL
            USING (organization_id = app_current_org_id())
            WITH CHECK (organization_id = app_current_org_id());
        GRANT ALL ON integration_credentials TO wflow_app, wflow_owner;
        """
    )

    # 10. Security definer lookup helpers for background activities and workers
    op.execute(
        """
        CREATE FUNCTION webhook_org_by_id(p_id uuid)
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT organization_id FROM webhooks WHERE id = p_id
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION webhook_org_by_id(uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION webhook_org_by_id(uuid) TO wflow_app")

    op.execute(
        """
        CREATE FUNCTION subscription_org_by_id(p_id uuid)
        RETURNS uuid
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
            SELECT organization_id FROM subscriptions WHERE id = p_id
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION subscription_org_by_id(uuid) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION subscription_org_by_id(uuid) TO wflow_app")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS subscription_org_by_id(uuid)")
    op.execute("DROP FUNCTION IF EXISTS webhook_org_by_id(uuid)")
    op.execute("DROP TABLE IF EXISTS integration_credentials CASCADE")
    op.execute("DROP TABLE IF EXISTS webhook_deliveries CASCADE")
    op.execute("DROP TABLE IF EXISTS webhooks CASCADE")
    op.execute("DROP TABLE IF EXISTS processed_provider_events CASCADE")
    op.execute("DROP TABLE IF EXISTS invoices CASCADE")
    op.execute("DROP TABLE IF EXISTS usage_counters CASCADE")
    op.execute("DROP TABLE IF EXISTS subscriptions CASCADE")
    op.execute("DROP TABLE IF EXISTS plans CASCADE")
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS suspended_reason")
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS suspended_at")
    op.execute("ALTER TABLE organizations DROP COLUMN IF EXISTS status")
