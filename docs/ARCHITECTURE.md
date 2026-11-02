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

### ADR-005 — AI is a later track
Per product decision, AI (model router, RAG, agents) is deferred until the core platform is complete.
pgvector is installed now; AI menu items show an honest "not available yet" state.

### ADR-006 — Temporal arrives with the workflow engine (M4)
Not started in M1 to avoid running infrastructure before it has a job.

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
