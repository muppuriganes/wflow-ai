# Development status

_Last updated: 2026-11-02 — end of M2._

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

## Test results (actually executed 2026-11-02)
- Backend: `uv run pytest` → **39 passed** (M1 + 11 channel/messaging tests incl. tenant isolation, idempotency, governance).
- Gateway: `npm test` → **21 passed** (QR lifecycle, failures, normalization, dedupe, rate limits, tenant checks, HTTP auth).
- Frontend: `npm test` → **14 passed**; `npm run build` passes.
- Manual: real services (API + gateway + worker + Redis + Postgres) driven from the browser — simulator end to end;
  WhatsApp Web start → live QR → cancel (session wiped); gateway crash → restore; role restrictions.

## Not built yet
Team inbox with assignment/notes/tags/real-time push (M3), CRM & leads (M3), media attachments (M3),
workflows (M4), schedules/templates/analytics (M5), integrations/billing/Super Admin console (M6), AI track.

## Known limitations
- Real WhatsApp linking needs a phone scan — please test with a spare number (see WHATSAPP_CONNECTOR.md risks).
- Agent Operators can reply via the API but the Channels page requires `connections.read`; their conversation view arrives with the M3 inbox.
- UI updates by polling (2–15 s); WebSocket/SSE push comes in M3.
- Media messages are stored as type + caption only (no file download yet).
- WhatsApp session data is protected by folder isolation, not encryption at rest (see WHATSAPP_CONNECTOR.md).
- `npm audit` reports a high-severity issue in `basic-ftp`, pulled in by puppeteer's proxy support; the gateway never uses FTP.
- Emails are sent inside the request (no queued retries yet). Org deletion is soft; no purge job yet.
- Production bundle is a single ~570 KB chunk; route-level code splitting is planned.
