# Development status

_Last updated: 2026-11-02 — end of M1._

## Working now (implemented, tested, verified in the browser)

| Area | Details |
|---|---|
| Registration | Creates user + first organization (owner). Organization name optional when signing up from an invitation |
| Login / logout | Argon2id, uniform errors for wrong password vs unknown email, audit of failures |
| Sessions | 15-min JWT in memory; rotating refresh cookie; reuse detection revokes the session family; list & revoke devices |
| Email flows | Verification, resend, forgot/reset password (resets sign out all sessions). Mail goes to Mailpit in dev |
| Organizations | Create, switch, rename, timezone, soft delete, leave |
| Team | Invite by email with role, preview link, accept (email must match), revoke/re-send, change role, remove |
| RBAC | 32 permissions, 6 built-in roles with rank rules; last-owner protection; permission matrix screen |
| Tenant isolation | PostgreSQL RLS on organizations, members, invitations, roles, audit logs; tested at API and DB level |
| Audit log | Org-level log (admins) + personal account activity; append-only for the app role |
| Platform | Request IDs, security headers, standard error envelope, Redis rate limiting on auth endpoints, health/readiness |
| UI | Design system, responsive app shell, org switcher, verify-email banner, honest "not available yet" pages for unbuilt modules, route error boundary |

## Test results (actually executed 2026-11-02)
- Backend: `uv run pytest` → **28 passed** (auth, orgs/RBAC, tenant isolation incl. raw-SQL RLS checks, platform).
- Frontend: `npm test` → **14 passed**; `npm run build` (strict `tsc` + Vite) passes.
- Manual browser run: register → dashboard → invite → accept as new user (agent role) → role-restricted views → sessions/activity; phone-width layout.

## Not built yet (shown as "not available yet" in the app)
Inbox, Channels/WhatsApp, Workflows, Contacts & CRM, Schedules, Integrations, Analytics, Execution logs,
Templates (M2–M6), AI Agents/AI Studio/Knowledge Base (AI track), billing, Super Admin console.

## Known limitations
- Emails are sent inside the request (≈tens of ms locally). A queued outbox with retries comes with the M2 worker.
- Organization deletion is soft; a scheduled purge job is not implemented yet.
- `refresh_tokens` and `user_action_tokens` are protected by application logic, not RLS (they are looked up before a user is known).
- Production bundle is a single ~550 KB chunk; route-level code splitting is planned.
- Custom (per-organization) roles are supported by the schema but have no UI yet.
- Super Admin flag exists (`python -m app.cli create-superadmin EMAIL`) but has no console yet (M6).

## Local test accounts
Created during manual verification in the dev database only (password policy: 10+ chars, letter + number).
Register your own via `/register`; all email is visible in Mailpit at http://localhost:58025.
