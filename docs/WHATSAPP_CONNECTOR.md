# WhatsApp connector

## Decision
Use [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (1.34.x, QR-linked WhatsApp Web session) now.
If it stops working or becomes unsuitable, switch that channel to Meta's official WhatsApp Business
Platform (Cloud API). Nothing outside the gateway adapter depends on WhatsApp specifics, so the inbox,
CRM and workflow engine do not change when that happens.

## Risks (shown to users before they connect, and must be in your terms of service)
- Unofficial client; WhatsApp's terms do not permit it. Linked numbers may be restricted or banned.
- Breaks when WhatsApp Web changes; delivery states are only what the library reports.
- Each connection runs a headless Chromium (~200–400 MB RAM): enforced per-organization limit
  (`MAX_CONNECTIONS_PER_ORG`) and a per-gateway cap (`GATEWAY_MAX_SESSIONS`).

## Architecture

```
Browser ──REST──► Backend ──HTTP (INTERNAL_API_TOKEN)──► Messaging gateway (Node + TS)
   ▲                 │  ▲                                   ├─ WhatsAppWebAdapter (whatsapp-web.js + Chromium)
   │ polling         │  │ GET /internal/channels/restore     ├─ SimulatorAdapter (dev/demo/tests)
   │                 ▼  │                                    └─ SessionManager (limits, dedupe, wipe)
   │            PostgreSQL ◄── channel-event worker ◄── Redis Stream "wflow:channel-events" ◄──┘
   └──── QR PNG ◄── backend ◄── Redis key wflow:gw:qr:<connection> (60 s TTL) ◄──────────────────┘
```

- **Commands** (backend → gateway): start, stop, logout, remove, send text, simulator scan/inbound.
- **Events** (gateway → backend) on a Redis Stream, consumed by `python -m app.workers.channel_events`
  with a consumer group (at-least-once, ack after commit). Contract: `backend/app/schemas/channel_events.py`
  = `services/messaging-gateway/src/events/types.ts`:
  `connection.state`, `message.received`, `message.sent`, `message.ack`.
- **QR codes** never go on the stream or in logs. The gateway renders a PNG and stores it in Redis for
  60 s; only members with `connections.manage` can fetch it.

## Connection states

| State | Meaning |
|---|---|
| NOT_CONNECTED | Created, never started |
| INITIALIZING | Chromium + WhatsApp Web loading |
| QR_PENDING | Waiting for the phone to scan (code refreshes ~every 20 s; gives up after `QR_MAX_RETRIES`) |
| AUTHENTICATING | Scanned, linking |
| CONNECTED | Receiving and sending |
| DISCONNECTED | Session dropped (network, gateway restart). **Manual reconnect** — no automatic retry loops |
| RECONNECTING | A person pressed Reconnect; resuming stored login |
| ERROR | Start failed / QR not scanned in time / auth failure (detail shown) |
| LOGGED_OUT | Unlinked from the phone or by a team member; session data deleted |

## Sessions on disk
`<SESSION_ROOT>/<sha256(org)[:16]>/<sha256(org:connection)[:16]>` — one folder per tenant, never exposed
via the API, deleted on logout/remove. Compact names are deliberate: Chromium's profile nests ~110
characters deep and full UUID paths exceeded Windows' 260-character limit, which made WhatsApp Web reload
mid-startup ("Execution context was destroyed"). A **new link** (never connected or after logout) always
starts from an empty profile; a previously connected session resumes its stored login.

After a gateway restart it asks the backend which connections were active or in progress and resumes them
(staggered). Graceful shutdown (SIGTERM) closes browsers without logging out.

## Messaging governance (enforced server-side)
- Reply only to contacts who messaged first (`not_customer_initiated` otherwise). No bulk/broadcast sending.
- Inbound `STOP` / `UNSUBSCRIBE` / `OPT OUT` marks the contact opted out; `START` / `SUBSCRIBE` re-engages.
- Per-connection send limit (`CHANNEL_SEND_LIMIT_PER_MINUTE`, backend; `GATEWAY_SEND_LIMIT_PER_MINUTE`, gateway).
- Duplicate-send protection: client-generated `client_message_id`, unique per organization, also remembered by the gateway.
- Inbound de-duplication by provider message id (gateway memory + database unique index).

## Not supported yet (documented, not faked)
- Media download/upload (images, documents, audio): messages are stored with type and caption; files arrive with MinIO in M3.
- Group conversations are stored (flagged `is_group`) but not specially handled.
- Contact sync and chat history import.
- Session data encryption at rest: the Chromium profile cannot be encrypted while in use. Protect the
  `gateway-sessions` volume with disk/volume encryption; a RemoteAuth-based encrypted store is a planned option.
- Containers run Chromium with `--no-sandbox` (no user namespaces in Docker by default); the container runs
  as a non-root user with no published ports.
