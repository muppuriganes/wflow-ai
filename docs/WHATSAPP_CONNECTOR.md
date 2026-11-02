# WhatsApp connector (planned for M2)

## Decision
Use [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js) (QR-linked WhatsApp Web session) now.
If it stops working or becomes unsuitable, switch that channel to Meta's official WhatsApp Business
Platform (Cloud API). The rest of the product must not change when that happens.

## Risks (must be disclosed to customers)
- Unofficial client; WhatsApp's terms do not permit it. Linked numbers may be restricted or banned.
- Breaks when WhatsApp Web changes; no delivery guarantees beyond what the library reports.
- Each connection runs a headless Chromium (~200–400 MB RAM) → per-organization connection limits and
  a global cap are required.

## Design constraints
- A separate Node.js + TypeScript service (`services/messaging-gateway`) owns all browser sessions.
- It emits **normalized channel events** (`message.received`, `message.ack`, `connection.state`, …) to Redis
  Streams; the backend never imports anything WhatsApp-specific. A **simulator channel** implements the same
  contract for tests and demos.
- Session data per connection in a tenant-namespaced, encrypted location; never exposed via the API; securely
  wiped on removal.
- No anti-ban/evasion techniques, no unsolicited bulk messaging; consent and opt-out records; conservative,
  configurable sending limits; duplicate-send protection.
- Connection states: `NOT_CONNECTED, INITIALIZING, QR_PENDING, AUTHENTICATING, CONNECTED, DISCONNECTED,
  RECONNECTING, ERROR, LOGGED_OUT`.
