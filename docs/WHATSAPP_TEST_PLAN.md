# WhatsApp Production Readiness Test Plan

**Version:** 1.0  
**Target Connector:** `whatsapp-web.js` (Headless Chromium + LocalAuth)  
**Safety Notice:** Always test with a **dedicated spare WhatsApp number**. Never connect a primary personal or critical business number due to WhatsApp's terms regarding unofficial clients.

---

## 1. Prerequisites Checklist

Before beginning the test, ensure all background services and workers are running locally:

```powershell
# 1. Infrastructure containers (Postgres, Redis, MinIO, Mailpit, Temporal)
docker compose up -d

# 2. Backend API (:8100)
cd backend
uv run uvicorn app.main:app --port 8100

# 3. Channel Event Worker (Redis Stream consumer -> DB)
cd backend
uv run python -m app.workers.channel_events

# 4. Temporal Workflow Worker (Workflow executions & schedules)
cd backend
uv run python -m app.workers.workflow_worker

# 5. Messaging Gateway (:8200)
cd services/messaging-gateway
npm run dev

# 6. Frontend SPA (:5180)
cd frontend
npm run dev
```

Verify gateway health:
```bash
curl http://127.0.0.1:8200/health
# Expected: {"status":"ok","sessions":<number of running sessions>}
```

---

## 2. Step-by-Step Test Execution Matrix

| Step | Action | Expected Result | Pass/Fail |
|---|---|---|---|
| **1. Create Channel** | In UI, navigate to `/channels` ➔ Click **Add Channel** ➔ Select **WhatsApp Web (Real WhatsApp)** ➔ Check risk acknowledgement checkbox ➔ Click **Create Connection**. | Connection created. UI redirects to Connection Detail page. Status shows `INITIALIZING` then `QR_PENDING`. | [ ] |
| **2. QR Code Rendering** | Observe QR card on Connection Detail page. | A crisp, scannable QR code PNG is rendered within 5–10 seconds. Expiration timer counts down (refreshes ~every 20s). | [ ] |
| **3. Phone QR Scan** | On your spare phone: Open WhatsApp ➔ Tap **Settings / Linked Devices** ➔ **Link a Device** ➔ Scan the QR on screen. | Gateway logs `authenticated` ➔ status changes to `AUTHENTICATING` ➔ status changes to `CONNECTED`. Phone number and push name display on connection card. | [ ] |
| **4. Inbound Text Message** | From an external customer phone, send: *"Hello from WhatsApp testing!"* to the connected spare number. | Message appears in `/inbox` in real time via Server-Sent Events (SSE). New contact created automatically with sender phone number. | [ ] |
| **5. Outbound Agent Reply** | In `/inbox`, open the conversation ➔ Assign to yourself ➔ Type: *"Welcome to WFlow AI! Your message was received."* ➔ Click **Send**. | Message delivers to customer phone. UI updates delivery status: Single tick (sent) ➔ Double gray ticks (delivered) ➔ Double blue ticks (read). | [ ] |
| **6. Inbound Image (Media)** | From customer phone, send an image (JPEG/PNG) with caption: *"Receipt photo"*. | Image is streamed through the gateway, uploaded to MinIO storage, and rendered as a preview card with caption in the inbox thread. | [ ] |
| **7. Inbound PDF / Document** | From customer phone, send a PDF document (< 16 MB). | File card appears in `/inbox` with filename, file size, and a working download link (presigned S3 URL). | [ ] |
| **8. Inbound Voice Note** | From customer phone, record and send a voice audio message. | Audio attachment appears in `/inbox` with playback controls. | [ ] |
| **9. Outbound Media Send** | In `/inbox`, click the paperclip attachment icon ➔ Select an image or PDF (< 16 MB) ➔ Add caption ➔ Send. | Media arrives on the customer phone with caption intact. | [ ] |
| **10. Opt-Out Governance (STOP)** | From customer phone, send: `STOP`. | Contact is marked `opted_out = true`. Inbox displays *"Contact has opted out from messaging"*. Message input is disabled. | [ ] |
| **11. Opt-In Re-engagement (START)** | From customer phone, send: `START`. | Contact is updated to `opted_out = false`. Warning banner disappears and agent reply box is re-enabled. | [ ] |
| **12. Automated Workflow Trigger** | Go to `/workflows` ➔ Create a workflow: **Trigger:** WhatsApp message received with keyword `testing` ➔ **Action:** Send WhatsApp message *"Automated reply received!"* ➔ Publish. Send *"testing the bot"* from customer phone. (Keywords match whole words, case-insensitive; symbols such as `#` are ignored, so `#test` would never match.) | Temporal workflow triggers within 1–2 seconds. Customer phone receives *"Automated reply received!"*. Execution details logged in `/executions`. | [ ] |
| **13. Gateway Restart & Session Restore** | With channel `CONNECTED`, stop gateway (`Ctrl+C` in gateway terminal) ➔ Wait 10 seconds ➔ Restart gateway (`npm run dev`). | Gateway calls `GET /internal/channels/restore`. It recovers the saved session from disk and automatically returns to `CONNECTED` without requiring a new QR scan. | [ ] |
| **14. Phone Unlink / Disconnect** | On your phone: Go to **Linked Devices** ➔ Tap active device ➔ Tap **Log out**. | Gateway captures `disconnected` event with reason `LOGOUT`. Status transitions to `LOGGED_OUT`. Session directory on disk is completely wiped. | [ ] |
| **15. Manual Reconnect** | On the Connection Detail page in UI, click **Reconnect**. | Gateway initializes a fresh session. A new QR code displays. Re-scanning reconnects the account. | [ ] |
| **16. Multi-Tenant Concurrency** | In WFlow AI, switch to or create Organization B ➔ Connect a second channel (or Simulator) in Org B. | Two independent Chromium processes run concurrently. Messages sent to Org A never leak to Org B (isolated by folder and PostgreSQL RLS). | [ ] |

---

## 3. Gateway Resource & Operational Limits

**Not measured yet.** Fill this table in during the live test (Task Manager / `docker stats`), and keep the
measured values here — do not copy estimates.

| Metric | Measured (fill in) | How to measure |
|---|---|---|
| RAM per connected session | ______ MB | Chromium processes started by the gateway, idle, after 10 minutes |
| CPU per session (idle) | ______ % | Same, averaged over 1 minute |
| CPU / time while starting (QR) | ______ % for ______ s | From "Create Connection" to QR shown |
| Time to restore after gateway restart | ______ s | Step 13 |

Configured limits (from the code):

| Limit | Default | Setting |
|---|---|---|
| WhatsApp sessions per gateway host | 10 | `GATEWAY_MAX_SESSIONS` (gateway) |
| Connections per organization | 3 (or the plan's channel limit, whichever is lower) | `MAX_CONNECTIONS_PER_ORG` + plan `max_channels` |
| Messages sent per connection per minute | 20 | `CHANNEL_SEND_LIMIT_PER_MINUTE` |

## 4. Known WhatsApp Web Edge Cases & Troubleshooting

### A. "Execution context was destroyed"
- **Cause:** Chromium user data profile path exceeded Windows 260-character MAX_PATH limit.
- **Resolution:** Compact hash directory naming is enforced in `manager.ts`: `<SESSION_ROOT>/<sha256(org)[:16]>/<sha256(org:conn)[:16]>`.

### B. "Session closed / Session not found" after OS Reboot
- **Cause:** Temporary folder wipe by OS or unclean Chromium shutdown leaving `SingletonLock`.
- **Resolution:** Gateway graceful shutdown (`SIGTERM` / `SIGINT`) properly invokes `client.destroy()`. Reconnect button re-reads stored profile.

### C. WhatsApp Web Version Changes
- **Cause:** WhatsApp updates its web client scripts, breaking internal selectors.
- **Resolution:** `whatsapp-web.js` version is pinned in `package.json`. If WhatsApp pushes a breaking web update, check `https://github.com/wwebjs/whatsapp-web.js/releases` for a patched release, upgrade the pinned version in a branch, run the gateway tests and this test plan, then deploy. Don't point the client at a hard-coded WhatsApp Web build from the internet without checking it first.

---

## 5. Live Test Sign-Off Record

- **Test Date:** _______________
- **Phone Number Used (Spare):** `+91 _______________`
- **WhatsApp Web Library Version:** `1.34.x`
- **Chromium / Puppeteer Version:** `24.x`
- **Gateway Host OS:** Windows 11
- **Tester Signature:** _______________
- **Status:** [ ] Ready for Staging / Production Launch

