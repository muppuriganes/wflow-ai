# Testing

## Backend (`backend/tests`)
Runs against a **real PostgreSQL** test database (`wflow_test`, created by the compose init script) so RLS is
exercised exactly as in production. Each session migrates `base → head` and syncs RBAC; each test cleans up.
Tests use Redis database 15 so they never consume the dev server's rate-limit quota. Email is captured in memory.

```bash
docker compose up -d
cd backend && uv run pytest
```

| File | Covers |
|---|---|
| `test_auth.py` | register, validation envelope, login, refresh rotation + reuse detection, logout, verify email, reset, change password, activity |
| `test_organizations.py` | create/switch, timezone validation, invitation lifecycle, viewer restrictions, email mismatch, revoked invites, role rank & last-owner rules, audit, soft delete, sign-up via invite |
| `test_tenant_isolation.py` | API returns 404 cross-tenant; raw SQL as the app role cannot see or write other tenants; no-context fails closed; audit log append-only |
| `test_channels.py` | connection lifecycle + QR, idempotent events, limits, inbound dedupe, idempotent replies, forward-only acks, opt-out/customer-initiated rules, rate limit, spoofed cross-tenant events, secure remove, restore endpoint, simulator guard |
| `test_inbox.py` | views/counts, assignment rules, reopen keeps owner, notes, takeover, viewer read-only, attachments out (sniffing, storage, gateway) and in (internal upload, linking, cross-org refusal), live notifications carry ids only |
| `test_crm.py` | phone normalisation, duplicate detection, inbound merge into an existing contact, consent timeline, tags, custom-field validation, pipeline + totals, owner membership, timezone-aware task filters, CRM permissions and isolation |
| `test_platform.py` | health/readiness, request id + security headers, rate limiter, error envelope |

## Messaging gateway (`services/messaging-gateway/src/**/*.test.ts`)
Vitest with a fake whatsapp-web.js client (no browser, no network): QR lifecycle, browser start failure,
disconnect reasons, logout wipe, message normalization and dedupe, idempotent and rate-limited sends,
tenant checks, path-traversal guard, compact session folders, simulator end to end, HTTP auth/validation.

```bash
cd services/messaging-gateway && npm test
```

Real WhatsApp is never used in automated tests; it requires a person to scan a QR code with a spare number.

## Frontend (`frontend/src/**/*.test.ts(x)`)
Vitest + Testing Library (jsdom). `fetch` is stubbed per test.

```bash
cd frontend && npm test
```

Covers: password/registration schemas mirroring the backend, open-redirect guard, login form (validation,
server errors, redirect), API client (401 → refresh → retry, field errors, network errors), honest
"not available yet" pages, formatting helpers.

## Manual verification checklist (per milestone)
Run the app, exercise each new screen in the browser at desktop and phone width, and check the console for errors.
