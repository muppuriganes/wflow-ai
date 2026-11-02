# Development status

_Last updated: 2026-11-02 — end of M5._

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
| Schedules | `trigger.schedule` workflow trigger; one-off and recurring (daily / weekly days / monthly / cron), evaluated in the organization's IANA timezone; Temporal Schedules with skip overlap policy and 15-min catchup window; manual "Run now"; optional contact tag target (dispatches a run per matching contact respecting opt-out); Schedules page (`/schedules`) with list, create, pause, resume, trigger, delete |
| Templates | Seeded starter blueprints (Keyword auto-reply, Out-of-hours reply, New-lead capture, Approval for discounts, Follow-up after no reply); Templates page (`/templates`) with category tabs, search, read-only React Flow canvas preview modal, and "Use template" instantiation into draft workflow |
| Analytics | Real data only (no mock data); `/analytics` and `/` Overview dashboard; date ranges (7d, 30d, 90d); conversation stats, response time, inbound/outbound volume timeline, CRM pipeline value & conversion, task health, workflow execution reliability & top failing steps; CSV export with `analytics.read` permission |

## Test results (actually executed 2026-11-02)
- Backend: `uv run pytest` → **75 passed** (M5 adds 13 tests covering schedules, templates, real analytics, and RLS tenant isolation). M4 baseline: 62 passed; M3 baseline: 48 passed.
- Gateway: `npm test` → **25 passed**.
- Frontend: `npm test` → **17 passed**; `npm run typecheck` 0 errors; `npm run build` passes cleanly with per-route code splitting for schedules, templates, and analytics.
- Manual: verified in browser against local stack (Postgres :55432, Redis :56379, MinIO :59000, Temporal :57233).

## Not built yet
M6 (Commercial platform: plans & usage limits, billing foundation, integrations framework / webhooks, Super Admin console), M7 (Hardening), AI track.

## Known limitations
- Real WhatsApp linking needs a phone scan — please test with a spare number (see WHATSAPP_CONNECTOR.md risks).
- Live updates use SSE; behind proxies that buffer responses, configure no buffering for `/events/stream` (nginx: `X-Accel-Buffering: no` is sent).
- Stickers, locations and contact cards are stored as type only; voice notes and media over 16 MB arrive without the file.
- Lead pipeline stages are fixed (no per-organization pipelines yet). Drag and drop needs a pointer; keyboard users change the stage in the lead dialog.
- The backend uses the MinIO root credentials locally; production should use a bucket-scoped access key (`S3_ACCESS_KEY`/`S3_SECRET_KEY`).
- WhatsApp session data is protected by folder isolation, not encryption at rest (see WHATSAPP_CONNECTOR.md).
- `npm audit` reports a high-severity issue in `basic-ftp`, pulled in by puppeteer's proxy support; the gateway never uses FTP.
- Workflows are acyclic (no loops) and branches don't re-join in parallel; the builder is not usable at phone
  width (the list, Execution Logs, Schedules, Templates, and Analytics are). Approvals can be decided in Execution Logs only (no notifications yet).
- `mypy app` still reports pre-existing typing issues (redis/boto3 stubs, a few older call sites); ruff is clean.
- Emails are sent inside the request (no queued retries yet). Org deletion is soft; no purge job yet.
