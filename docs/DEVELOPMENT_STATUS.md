# Development status

_Last updated: 2026-11-03 — end of M7, after the M6/M7 review._

## Working now (implemented, tested, verified in the browser)

### M1 — Foundation
| Area | Details |
|---|---|
| Accounts | Register (org optional when joining by invite), login, logout, verify email, forgot/reset password, change password, sessions list/revoke |
| Security | 15-min JWT in memory; rotating refresh cookie with reuse detection; Argon2id; rate-limited auth endpoints; audit log |
| Organizations & team | Create/switch/rename/timezone/soft delete/leave; invitations; 6 roles with rank rules; last-owner protection |
| Tenant isolation | PostgreSQL RLS on every tenant table, tested at API and raw-SQL level |

### M2 — Channels & messaging
| Area | Details |
|---|---|
| Messaging gateway | Node + TypeScript service owning sessions; internal token auth; per-gateway session cap; graceful shutdown; session restore after restart |
| WhatsApp Web | whatsapp-web.js adapter: real QR (PNG via Redis, 60 s TTL), connection states, disconnect/logout/auth-failure handling, manual reconnect, send text, delivery acks. **Verified up to a live WhatsApp QR code**; scanning with a phone was not done here |
| Simulator channel | Same pipeline without a phone: QR → scan → connected → inbound → reply → delivered/read |
| Event pipeline | Normalized events on a Redis Stream → backend worker (consumer group, ack after commit), idempotent handlers |
| Messaging data | Contacts, conversations, messages; dedupe by provider id; unread counts; forward-only delivery status |
| Governance | Customer-initiated replies only; STOP/START opt-out; per-connection send limits; idempotent sends; risk acknowledgement before linking WhatsApp |
| UI | Channels list, add channel (with risk notice), connection page (QR, status, reconnect/logout/remove, connection log, simulator controls), basic per-channel conversations with replies |

### M3 — Inbox & CRM
| Area | Details |
|---|---|
| Team inbox | Views (mine / unassigned / all open / resolved / archived) with counts, search, channel/tag/priority filters, three-pane layout, phone layout |
| Conversation handling | Assign (self-claim with `inbox.reply`, reassign with `inbox.assign`, only to members who can use the inbox), status, priority, resolve/reopen (a new customer message reopens and keeps the owner), human takeover flag, assignment history |
| Internal notes | Per conversation, team-only, with author and time |
| Attachments | Send images/PDF/Office/text/audio/video up to 16 MB (type detected from bytes, names sanitized); inbound WhatsApp media uploaded by the gateway; files in MinIO under the org prefix; short-lived signed links |
| Live updates | Server-Sent Events per organization over Redis pub/sub (ids only, clients refetch); "Live" indicator; slow polling fallback |
| Contacts | Create (phone normalised; dedupe by phone; links future WhatsApp messages), edit, soft delete, search, tags, manual opt-out, timeline with notes |
| Custom fields | Per-organization definitions for contacts and leads (text, number, date, list, yes/no; required; archive), validated server-side |
| Leads | Fixed 7-stage pipeline board with drag and drop, totals per stage, owner, value/currency, score, expected close, lost reason; stage changes recorded on the timeline |
| Tasks | Follow-ups with timezone-aware due dates (viewer-local "today"), assignee, links to contact/lead/conversation; overdue/today/upcoming/done filters |

### M4 — Workflow engine
| Area | Details |
|---|---|
| Builder | React Flow canvas: palette (click or drag), 24 step types with generated settings forms, branches with labelled outputs, autosave, undo/redo, inline validation on cards, minimap/zoom |
| Lifecycle | Validate, publish immutable versions, restore, duplicate, activate/pause/archive, unpublished-changes indicator |
| Test runs | Dry runs of the draft on a real conversation: actions describe what they would do, waits skipped, results overlaid on the canvas |
| Execution | Temporal workflows: durable delays, wait-for-reply (replied/timeout), approvals (approve/reject/expire), human handover; idempotent steps; trigger de-duplication; retries with backoff |
| Triggers | Keyword/any inbound message, new conversation, new contact, manual (“Run now”), webhook with idempotency key |
| Execution Logs | Runs list with filters, run detail with per-step input/output, retry, cancel; Approvals queue |

### M5 — Schedules, templates & analytics
| Area | Details |
|---|---|
| Schedules | “On a schedule” workflow trigger (timing lives on the schedule, so one workflow can have several); one-off and recurring (daily / weekly days / monthly / cron), evaluated in the organization's IANA timezone; Temporal Schedules with skip overlap policy and 15-min catchup window; manual "Run now"; optional contact tag target (one run per tagged contact with their latest conversation, skipping opted-out contacts and conversations a person has taken over; scheduled workflows can send WhatsApp messages); every fire is de-duplicated, so engine retries never start runs twice; config, cron and timezone validated; Schedules page (`/schedules`) with list, create, edit, pause, resume, trigger, delete |
| Templates | Seeded starter blueprints (Keyword auto-reply, Out-of-hours reply, New-lead capture, Approval for discounts, Follow-up after no reply); Templates page (`/templates`) with category tabs, search, read-only React Flow canvas preview modal, and "Use template" instantiation into draft workflow |
| Analytics | Real data only (no mock data); `/analytics` and `/` Overview dashboard; date ranges (7d, 30d, 90d); conversation stats, response time, inbound/outbound volume bar chart timeline, per-agent first response time calculation, CRM pipeline value & conversion, task health, workflow execution reliability & top failing steps; CSV export with `analytics.read` permission (formula-safe cells, 50k-row cap); headline numbers follow the selected range |

### M6 — Commercial platform
| Area | Details |
|---|---|
| Plans & Metering | Tiered plans (Free, Starter, Growth, Business) with monthly/yearly pricing; concurrency-safe monthly usage counters (workflow runs, outbound messages, storage); resource limit validation (seats, channels, workflows, schedules); organization suspension columns & enforcement blocking triggers/outbound/schedules; Plans & Billing page (`/billing`) with usage meters, interval toggle, invoice table |
| Integrations Framework | Outgoing webhooks with HMAC-SHA256 signatures (`X-WFlow-Signature`), delivery logging with response codes, retry mechanism, and automatic pause after 10 consecutive delivery failures; Encrypted credential store using AES-256-GCM with secret masking (`••••1234`); SSRF protection guard blocking loopback, private ranges (RFC 1918), link-local cloud metadata (169.254.169.254), and internal infrastructure ports; `action.http_request` workflow node supporting credential injection, SSRF checks, and response truncation (256 KB); Integrations page (`/integrations`) |
| Super Admin Console | Cross-tenant administration (`/admin`) guarded by `is_superadmin`; real-time diagnostic health probes (Postgres, Redis, Temporal, Storage, Gateway); organizations search and filter by plan/status; plan override & trial day extension modal; organization suspension & restore controls with mandatory audit reasons; tenant inspection modal with usage breakdown and audit trails |
| Billing Foundation | `BillingProvider` interface with `StripeTestBillingProvider` implementation running exclusively in test mode (never moving real money); test checkout sessions, portal sessions, and invoice listings; public webhook endpoint (`/api/v1/billing/webhook/stripe`) verifying HMAC signatures, replay protection via `processed_provider_events`, and automatic RLS context resolution via `org_id_by_stripe_customer_or_sub` |

### M7 — Hardening & Production Readiness
| Area | Details |
|---|---|
| Observability & Metrics | Prometheus metrics exposition at `GET /metrics`; counters and duration histograms for HTTP traffic with UUID path normalization (`:id`) to eliminate high cardinality; active and total database connection pool gauges (`wflow_db_pool_active_connections`, `wflow_db_pool_size`); counters for workflow runs, outgoing webhook deliveries, messaging events, failed logins, and account lockouts |
| Brute-Force & Security Headers | Distributed Redis-backed brute-force account lockout: 5 consecutive failed logins trigger an automatic 15-minute lockout with HTTP 429 `AccountLockedError`; failed attempts and lockout states auto-cleared on successful login; production security headers enforced including HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`) and CSP (`Content-Security-Policy`); production configuration guards validating `JWT_SECRET`, encryption keys, and cookie security flags |
| Production Ingress & Compose | Production Nginx reverse-proxy configuration (`infrastructure/nginx/nginx.conf`) with zone rate-limiting (`api_limit`, `auth_limit`), real-time SSE stream buffering bypass (`proxy_buffering off; X-Accel-Buffering: no`), internal endpoint isolation (`/api/v1/internal/` 403), and 20M upload ceilings; production Docker Compose (`docker-compose.prod.yml`) with container resource constraints, health probes, and isolated service networks; Prometheus scraper configuration (`infrastructure/monitoring/prometheus.yml`) |
| Disaster Recovery & Backup | Cross-platform automated PostgreSQL backup scripts (`scripts/backup.sh`, `scripts/backup.ps1`) using custom-format compression (`pg_dump -Fc`), SHA-256 checksum generation, and rolling 7-day retention pruning; verified restore scripts (`scripts/restore.sh`, `scripts/restore.ps1`) terminating active connections, executing `pg_restore`, and re-running `sync-rbac`; complete runbook with RPO (<24h) and RTO (<30m) targets in `docs/DISASTER_RECOVERY.md` |
| Load Testing & Benchmarking | High-concurrency async load testing benchmark (`backend/tests/load/load_test.py`) measuring RPS and p50/p95/p99 response latency across health probes, Prometheus metrics, and authenticated API routes |

### M6/M7 review fixes (2026-11-03)
| Area | What was wrong → what it does now |
|---|---|
| Monthly limits | Runs and messages were never blocked (wrong limit keys, and a counter check that only worked on a month's first use) → one conditional SQL update checks and counts atomically |
| Plan changes | `POST /plans/change` upgraded to any paid plan for free → only free plans self-service; paid plans need a completed checkout or a Super Admin |
| Test checkout | Redirected back but never changed the plan → signed, expiring, organization-bound session redeemed by the Billing page (test mode only; refused in production) |
| Production secrets | Public default credentials key and billing webhook secret were accepted (forged webhooks could upgrade any org) → startup refuses them; `BILLING_TEST_MODE` and `OUTBOUND_ALLOW_PRIVATE_NETWORKS` must be off; `.env.production.example` added |
| Outgoing webhooks | Never fired for real events (only "ping") → message received/sent, contact created, lead stage changed and workflow run completed/failed are delivered through Temporal with 6 attempts and backoff; failure counter is atomic |
| HTTP request step | Credentials were sent as `Bearer ('bearer', '…')`; errors crashed with a TypeError; whole responses were read into memory; credential failures were ignored → fixed; credential picker in the builder; publish checks the credential exists |
| SSRF | Checked DNS only before connecting (rebinding), missed IPv4-mapped IPv6 and carrier-grade NAT, blocked the event loop → only globally routable addresses, checked again on the IP actually dialled |
| Admin health | Gateway always "unavailable", storage always "ok" without checking → both really checked (found and fixed blank local storage credentials breaking uploads) |
| Ingress | nginx live-updates rule matched a path that doesn't exist; `/metrics` was public → fixed; metrics only inside the compose network |
| Landing page | Unbacked claims ("99.98% uptime", "↓68%", "live telemetry", Meta API "swappable") → labelled as an example tour; claims removed |

## Test results (actually executed 2026-11-03)
- Backend: `uv run pytest` → **107 passed**. The review replaced mocked integration tests with real ones: a local HTTP receiver, real inbound events and Temporal deliveries (signatures, retry, auto-disable), the HTTP step with a saved credential, SSRF cases, monthly limits, checkout forgery/cross-org/open-redirect, production secret guards, and super-admin scoping of ordinary screens. Earlier: M7 103 (as reported), M5 81, M4 62.
- Gateway: `npm test` → **25 passed**.
- Frontend: `npm test` → **21 passed** (4 tests in `LandingPage.test.tsx` verifying hero, interactive studio tabs, monthly/yearly pricing toggle, and FAQ accordion); `npm run typecheck` 0 errors; `npm run build` passes cleanly with per-route code splitting for landing, billing, integrations, admin, schedules, templates, and analytics.

## Not built yet
- AI track (deferred by product owner until application completion).
- A live payment provider (Stripe or Razorpay): only the test-mode provider exists, so paid plans cannot be sold yet.
- Super Admin user management (search users, disable accounts, revoke sessions, login history).

## Known limitations
- Real WhatsApp linking needs a phone scan — please test with a spare number (see WHATSAPP_CONNECTOR.md risks).
- Live updates use SSE; behind proxies that buffer responses, configure no buffering for `/events/stream` (nginx: `X-Accel-Buffering: no` is sent).
- Stickers, locations and contact cards are stored as type only; voice notes and media over 16 MB arrive without the file.
- Lead pipeline stages are fixed (no per-organization pipelines yet). Drag and drop needs a pointer; keyboard users change the stage in the lead dialog.
- Locally, blank `S3_ACCESS_KEY`/`S3_SECRET_KEY` fall back to the MinIO root login; production should use a bucket-scoped key.
- Account lockout is per email address, so anyone can lock a known user out for 15 minutes with 5 wrong passwords (a common trade-off; per-IP limits apply too).
- WhatsApp session data is protected by folder isolation, not encryption at rest (see WHATSAPP_CONNECTOR.md).
- `npm audit` reports a high-severity issue in `basic-ftp`, pulled in by puppeteer's proxy support; the gateway never uses FTP.
- Workflows are acyclic (no loops) and branches don't re-join in parallel; the builder is not usable at phone width (the list, Execution Logs, Schedules, Templates, Analytics, Integrations, and Billing are).
- `mypy app` still reports pre-existing typing issues (redis/boto3 stubs, a few older call sites); ruff is clean.
- Emails are sent inside the request (no queued retries yet). Org deletion is soft; no purge job yet.
