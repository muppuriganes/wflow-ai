# Architecture

## Overview

```
 Browser (React SPA)
     │  HTTPS, JWT access token (memory) + httpOnly refresh cookie
     ▼
 FastAPI backend ──────────────► PostgreSQL 17 (+pgvector)
  ├─ auth / orgs / RBAC            RLS enforces tenant isolation
  ├─ (M3) inbox, CRM
  ├─ (M4) workflow management ───► Temporal (M4)
  └─ rate limiting ─────────────► Redis  (M2: event streams)
                                   MinIO  (files, M3+)
 (M2) Messaging gateway (Node + whatsapp-web.js) ⇄ Redis Streams ⇄ backend workers
```

A modular monorepo: `frontend/`, `backend/`, `services/messaging-gateway/` (M2), `infrastructure/`, `docs/`.
Services are deployed independently; we avoid microservices that do not need to scale separately.

## Key decisions

### ADR-001 — Tenant isolation with PostgreSQL Row Level Security
Every tenant-owned table has RLS policies keyed on `app.current_org_id` / `app.current_user_id`,
set per transaction (`set_config(..., is_local => true)`).

- The app connects as `wflow_app`: **not** the table owner, no `BYPASSRLS`, so policies always apply.
- Migrations run as `wflow_owner`.
- The context lives in `session.info` and is re-applied by an SQLAlchemy `after_begin` hook, so a
  mid-request commit cannot silently drop it.
- With no context the policies match nothing — the database **fails closed**.
- Application checks (membership + permission) run in addition to RLS. Defence in depth: a bug in
  one layer does not leak data.

Consequence: inserts that need to read back rows (`RETURNING`) must happen inside the right context;
audit rows set `created_at` client-side so anonymous events never need a read-back.

### ADR-002 — Authentication
- Short-lived JWT access tokens (15 min) kept only in memory in the SPA.
- Opaque refresh tokens (stored as SHA-256) in an `httpOnly`, `SameSite=Strict` cookie scoped to
  `/api/v1/auth`. Rotated on every use; replaying a rotated token revokes the whole session family.
- The SPA serialises refreshes across tabs with the Web Locks API so rotation never races.
- Argon2id password hashing; login does a dummy hash for unknown emails (constant-ish timing).

### ADR-003 — RBAC as data
Permissions and the six built-in organization roles are defined in `backend/app/core/rbac.py` and
synced idempotently into the database (`python -m app.cli sync-rbac`). Roles have a **rank**: members can
only grant/manage roles at or below their own. Super Admin is a platform flag (`users.is_superadmin`),
never an organization role.

### ADR-004 — Channels behind an interface; whatsapp-web.js first
See [WHATSAPP_CONNECTOR.md](WHATSAPP_CONNECTOR.md). The inbox, CRM and workflow engine depend only on a
normalized channel event format, so the connector can be swapped (e.g. for the official Cloud API) later.

Implemented in M2 — see WHATSAPP_CONNECTOR.md. Events travel over a Redis Stream consumed by a backend
worker with idempotent handlers; commands go to the gateway over authenticated internal HTTP.

### ADR-007 — Fixed lead pipeline
Lead stages (NEW → CONVERTED/LOST) are an enumeration, not per-tenant data: reports and workflow
conditions can rely on them. Custom pipelines can be added later as a separate concept.

### ADR-008 — Live updates with Server-Sent Events
The browser opens `GET /organizations/{id}/events/stream` with `fetch` (so the access token travels in the
Authorization header). Services publish "what changed" (ids only) to a Redis channel per organization after
commit; the client invalidates the affected queries and refetches through the normal API, so permissions and
RLS apply to everything displayed. Streams end at the access-token lifetime and reconnect with a fresh token.
One-directional push is all the UI needs, so SSE was chosen over WebSockets (simpler proxies, no extra protocol).

### ADR-009 — Files
Uploads are validated by content sniffing, stored in S3-compatible storage under `<org_id>/attachments/…`,
and served with 5-minute signed links. The gateway never holds storage credentials: outbound media is fetched
from a signed link; inbound media is POSTed to an internal backend endpoint before the message event.

### ADR-005 — AI is a later track
Per product decision, AI (model router, RAG, agents) is deferred until the core platform is complete.
pgvector is installed now; AI menu items show an honest "not available yet" state.

### ADR-006 — Temporal for workflow execution (M4)
Runs are Temporal workflows: delays, waits for a reply and approvals are durable timers/signals that
survive restarts and can last weeks. The workflow only interprets a compiled plan; all I/O happens in
idempotent activities. See [WORKFLOW_ENGINE.md](WORKFLOW_ENGINE.md).

### ADR-010 — Workflow definitions as versioned JSONB
The builder's React Flow graph is stored as JSONB (`workflows.draft_definition`). Publishing writes an
immutable `workflow_versions` row with the definition and its compiled plan; runs reference the version
they started with. Steps are typed, registry-defined operations — there is no user code execution.

### ADR-011 — Commercial platform, billing abstraction & usage metering
Tenant quotas (seats, channels, workflows, schedules, monthly runs, monthly messages, storage) are
metered at the database layer. Monthly usage counters (`usage_counters`) use concurrency-safe PostgreSQL
upserts (`ON CONFLICT (organization_id, year_month) DO UPDATE`). Commercial billing uses an abstract
`BillingProvider` interface with a `StripeTestBillingProvider` implementing test-mode checkout sessions,
customer portal sessions, and replay-protected webhook ingestion (`processed_provider_events`). Webhook
endpoints resolve tenant RLS context via `SECURITY DEFINER` function `org_id_by_stripe_customer_or_sub`.

### ADR-012 — SSRF protection & encrypted credential vault
Outgoing HTTP actions (`action.http_request`) and webhook destinations are protected by synchronous DNS
pre-resolution and IP filtering: loopback, private ranges (RFC 1918), link-local cloud metadata
(`169.254.169.254`), and infrastructure ports (Postgres, Redis, Temporal, Gateway) are strictly blocked.
Third-party API keys and Bearer tokens are encrypted at rest with AES-256-GCM using `INTEGRATION_ENCRYPTION_KEY`,
with masked strings (`••••1234`) returned in API responses and logs. Outgoing webhooks carry HMAC-SHA256
signatures (`X-WFlow-Signature: sha256=...`) and auto-pause after 10 consecutive failures.

## Backend layout

```
backend/app/
  api/v1/        HTTP routers (thin): validation, auth deps, response shaping
  api/deps.py    current user, org context, permission gates, rate limits
  services/      business rules + transactions (commit explicitly)
  models/        SQLAlchemy models
  schemas/       Pydantic request/response models
  core/          config, security, errors, logging, rbac, email, rate limiting
  database/      engine, sessions, RLS context
  workflow_engine/ node registry, graph compiler, Temporal workflow + activities, triggers
  workers/       channel event consumer, Temporal workflow worker
  cli.py         operational commands
migrations/      Alembic (RLS policies live in the migrations)
```

## Frontend layout

```
frontend/src/
  app/           router, navigation config
  components/ui/ design system (Button, Field, Card, Dialog, Table, Tabs, states…)
  layouts/       AppLayout (sidebar, org switcher), AuthLayout
  modules/       feature screens (auth, dashboard, settings, coming-soon)
  services/      API client + typed endpoint wrappers
  stores/        auth + organization context
```

## Conventions
- API base `/api/v1`; errors use one envelope: `{"error": {"code", "message", "details", "request_id"}}`.
- Every response carries `X-Request-ID` (accepted from the client when well-formed) for tracing.
- Structured JSON logs in production; keys that look like secrets are masked.
