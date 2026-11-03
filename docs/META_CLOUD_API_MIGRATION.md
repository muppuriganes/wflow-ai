# Meta Cloud API Migration Guide

## 1. Overview & Strategy

WFlow AI is designed with a **swappable channel adapter architecture**. 
Currently, the default channel provider uses `WhatsAppWebAdapter` (`whatsapp-web.js` + headless Chromium). If your organization scales beyond browser-based sessions, requires official Meta verification, or if WhatsApp Web experiences upstream protocol restrictions, you can switch seamlessly to **Meta's Official WhatsApp Cloud API** without altering any downstream business logic.

Because the Team Inbox, CRM pipeline, visual workflow engine, and analytics consume **normalized channel events** (`wflow:channel-events` over Redis Streams), replacing the underlying messaging transport requires **zero changes** to:
- Visual Workflow Builder & Temporal nodes
- Contact and lead pipeline tracking
- Team Inbox and Server-Sent Events (SSE) streaming
- Tenant isolation and PostgreSQL Row-Level Security (RLS)

---

## 2. Channel Adapter Contract

Every messaging transport in WFlow AI implements the TypeScript `ChannelAdapter` interface in `services/messaging-gateway/src/adapters/types.ts`:

```typescript
export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendText(chatId: string, text: string): Promise<string>;
  sendMedia(chatId: string, media: MediaFile, caption?: string): Promise<string>;
  logout?(): Promise<void>;
}

export interface AdapterHooks {
  onState(state: ConnectionState, reason?: string, metadata?: Record<string, unknown>): void;
  onQr?(qrPngBase64: string): void;
  onMessage(msg: NormalizedMessage, media?: MediaFile): void;
  onAck(providerMessageId: string, status: "sent" | "delivered" | "read" | "failed"): void;
}
```

---

## 3. Meta Cloud API Adapter Specification

To plug in Meta Cloud API, create `services/messaging-gateway/src/adapters/meta-cloud.ts`:

### A. Credentials & Configuration
Stored securely in the existing AES-256-GCM credential vault (`integration_credentials`):
- `PHONE_NUMBER_ID`: The unique WhatsApp Phone Number ID assigned by Meta.
- `WABA_ID`: WhatsApp Business Account ID.
- `ACCESS_TOKEN`: Permanent System User Access Token generated in Meta Business Manager.
- `WEBHOOK_VERIFY_TOKEN`: Random 32+ character string for Meta webhook challenge validation.
- `APP_SECRET`: Meta App Secret used for cryptographic signature verification (`X-Hub-Signature-256`).

### B. Outbound Message Dispatch (`sendText` & `sendMedia`)
Outgoing messages call Meta Graph API:
- Endpoint: `POST https://graph.facebook.com/v21.0/{PHONE_NUMBER_ID}/messages`
- Headers:
  ```http
  Authorization: Bearer {ACCESS_TOKEN}
  Content-Type: application/json
  ```
- Payload (Text):
  ```json
  {
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "919876543210",
    "type": "text",
    "text": { "body": "Hello from WFlow AI!" }
  }
  ```
- Returns `messages[0].id` (e.g. `wamid.HBg...`), which maps directly to `provider_message_id`.

### C. Inbound Webhook Ingestion & Verification
The messaging gateway exposes two standard routes:
1. **Verification Handshake (`GET /webhook/meta`):**
   ```typescript
   if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
     return reply.send(req.query["hub.challenge"]);
   }
   return reply.status(403).send("Verification failed");
   ```
2. **Event Notification (`POST /webhook/meta`):**
   - Verify `X-Hub-Signature-256` using `crypto.createHmac("sha256", APP_SECRET)`.
   - Parse payload:
     - **Inbound Messages (`entry[0].changes[0].value.messages`):**
       Normalized via `normalizeMetaMessage()` and passed to `hooks.onMessage(...)`.
     - **Delivery Status Updates (`entry[0].changes[0].value.statuses`):**
       Maps Meta statuses (`sent`, `delivered`, `read`, `failed`) to `hooks.onAck(status.id, mappedStatus)`.

---

## 4. Message Normalization Matrix

| Meta Cloud API Field | WFlow Normalized Event Field |
|---|---|
| `messages[0].id` | `provider_message_id` |
| `messages[0].from` | `from_phone` / `customer_id` |
| `messages[0].timestamp` | `occurred_at` (ISO-8601 UTC) |
| `contacts[0].profile.name` | `sender_name` |
| `messages[0].text.body` | `content` (`message_type: 'text'`) |
| `messages[0].image.id` | Downloaded via Graph API ➔ uploaded to MinIO ➔ `media_url` |
| `statuses[0].status == 'read'` | `status: 'read'` (`message.ack` event) |

---

## 5. Architectural Comparison

| Dimension | `whatsapp-web.js` (Current) | Meta Cloud API (Official) |
|---|---|---|
| **Setup Cost** | ₹0 / Free | Meta conversation fees apply |
| **Hardware / RAM** | ~250–350 MB RAM per active session (Chromium) | < 10 MB RAM (pure stateless HTTP calls) |
| **Max Connections** | ~5–10 per CPU core | Unlimited per host |
| **Account Safety** | Risk of WhatsApp temporary ban / disconnect | 100% compliant with Meta Business Terms |
| **Session Persistence** | Stored browser profiles on disk (`gateway-sessions`) | Fully stateless (managed on Meta servers) |
| **Message Templates** | Send any freeform text anytime | 24-hour service window; templates required outside 24h |
| **Throughput** | ~20–30 messages per minute | Up to 1,000 messages per second (Tier dependent) |

---

## 6. Migration Checklist

When transitioning a production organization to Meta Cloud API:
1. [ ] Create a Meta Developer App and link WhatsApp Business Account (WABA).
2. [ ] Register phone number and complete Business Verification in Meta Business Manager.
3. [ ] Generate System User Access Token with `whatsapp_business_messaging` permissions.
4. [ ] In WFlow AI, select channel type **Meta Cloud API** and input `PHONE_NUMBER_ID` and Token.
5. [ ] Configure Meta Webhook URL to `https://<your-domain>/api/v1/channels/webhook/meta`.
6. [ ] Send test message; verify delivery ticks and automated workflow execution.

