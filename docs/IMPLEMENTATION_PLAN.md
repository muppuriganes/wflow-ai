# Implementation plan

Agreed scope (2026-11-02): **commercial product**; **build the application first, AI later**;
**whatsapp-web.js** as the WhatsApp connector, replaceable by Meta's official API if it stops working.

Each milestone ends with migrations applied, backend + frontend tests run (results reported honestly),
builds passing and `DEVELOPMENT_STATUS.md` updated.

| # | Milestone | Scope | Status |
|---|---|---|---|
| M0 | Setup | Monorepo, Docker Compose (Postgres+pgvector, Redis, MinIO, Mailpit), env config, docs | ✅ Done |
| M1 | Foundation | Auth (register, login, refresh rotation, logout, verify email, reset password), organizations, invitations, RBAC (6 roles), RLS tenant isolation, audit log, design system, app shell, auth + admin screens | ✅ Done |
| M2 | Channels & messaging | Node messaging gateway with whatsapp-web.js adapter (QR, states, tenant-isolated sessions, reconnect, per-org limits, restore), simulator channel, normalized events via Redis Streams with idempotency, consent/opt-out, sending limits, connection screens | ✅ Done |
| M3 | Inbox & CRM | Real-time inbox (SSE), assignment, notes, tags, status/priority, human takeover, attachments (MinIO), contacts + custom fields, lead pipeline, follow-up tasks, customer timeline | ✅ Done |
| M4 | Workflow engine | React Flow editor, validation/compilation, versions & publishing, Temporal execution, rule-based nodes (triggers, conditions, actions, data, logic, human), execution monitoring | ✅ Done |
| M5 | Schedules, templates, analytics | Timezone-aware schedules (Temporal), starter template library with canvas preview, dashboard & analytics from real data, CSV export | ✅ Done |
| M6 | Commercial platform | Plans & usage limits, billing foundation (Stripe test provider), integrations framework (signed webhooks, encrypted credentials, SSRF guard), Super Admin console | ✅ Done |
| M7 (next) | Hardening | OpenTelemetry/Prometheus/Grafana, load & security testing, backups, production config, deployment docs | Planned |
| AI | AI track | Ollama + model router, RAG on pgvector, agents & tool registry — plugs in as new node types and screens | After M7 |
