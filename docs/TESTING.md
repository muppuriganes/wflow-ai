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
| `test_platform.py` | health/readiness, request id + security headers, rate limiter, error envelope |

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
