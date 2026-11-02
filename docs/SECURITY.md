# Security

## Implemented (M1)
- **Passwords:** Argon2id (pwdlib). Policy: 10–128 chars, at least one letter and one digit (enforced server-side; mirrored in UI).
- **Tokens:** 15-minute HS256 JWT access tokens held in memory; opaque refresh tokens stored only as SHA-256,
  rotated on every use, `httpOnly` + `SameSite=Strict` + path-scoped cookie, `Secure` required in production.
  Replay of a rotated token revokes the whole session family and is audited.
- **Email links:** single-use, hashed, expiring (verify 48h, reset 60 min, invite 7 days). New link invalidates older ones.
- **No account enumeration** on forgot-password; uniform login errors; dummy hash for unknown emails.
- **Tenant isolation:** PostgreSQL RLS + application membership checks; non-members get 404.
- **Authorization:** permission checks on every org-scoped service call (route guards are an extra layer);
  rank rules stop privilege escalation; last-owner protection.
- **Audit:** append-only `audit_logs` (runtime role cannot UPDATE/DELETE).
- **Least privilege DB role** for the app; migrations under a separate owner role.
- **Rate limiting** (Redis) on register, login, forgot/reset, verify, resend, invite preview.
- **Headers:** `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`; strict CORS allow-list with credentials.
- **Logging:** structured; keys resembling secrets (`password`, `token`, `cookie`, `authorization`, …) masked.
- **Secrets** only via environment; production refuses to start with a placeholder `JWT_SECRET` or insecure cookies.
- **Open-redirect protection** on `?next=` after sign-in.

## Messaging (M2)
- Gateway is an internal service: bound to 127.0.0.1 locally, unpublished in Compose; every call needs
  `INTERNAL_API_TOKEN` (constant-time compare). Production refuses short tokens and an enabled simulator.
- QR codes: Redis only, 60 s TTL, served to `connections.manage` only, never logged or put on the event stream.
- Session folders per tenant; ids validated as UUIDs before touching the filesystem; wiped on logout/remove.
- The worker applies an event only if the connection belongs to the event's organization (RLS + explicit check).
- Gateway logs redact message text, QR data and tokens.
- Governance rules (opt-out, customer-initiated, rate limits, idempotent sends) are enforced in the backend.

## Inbox & CRM (M3)
- File uploads: 16 MB cap, type from magic bytes (client name/type ignored), allow-list of formats, sanitized
  file names, org-prefixed storage keys, signed links that expire after 5 minutes.
- Live stream carries ids only; stream requires `inbox.read`, ends at token lifetime; DB connection released.
- Assignment only to active members whose role can read the inbox; reassigning others needs `inbox.assign`.
- Custom field values validated against definitions (unknown keys rejected); contact timeline append-only.
- CRM cross-tenant access returns 404 (tested), including creating a lead for another org's contact.

## Commercial Platform & Integrations (M6)
- **SSRF protection:** Synchronous DNS pre-resolution and IP validation on all user-supplied URLs (`action.http_request` workflow nodes and webhook endpoints). Blocks loopback (127.0.0.0/8, ::1), private IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16), IPv6 ULA/link-local, cloud instance metadata (`169.254.169.254`), multicast, and internal service ports (55432, 56379, 57233, 8100, etc.).
- **Credential encryption at rest:** Integration credentials (Bearer tokens, API keys) encrypted with authenticated AES-256-GCM via `INTEGRATION_ENCRYPTION_KEY`. API responses and audit logs return only masked strings (`••••1234`).
- **Webhook signing & replay protection:** Outgoing webhooks signed with HMAC-SHA256 (`X-WFlow-Signature: sha256=...`). External billing webhooks verify cryptographic signatures with timestamp window checks and deduplicate event IDs in `processed_provider_events`.
- **Super Admin isolation:** Admin console strictly guarded by `require_superadmin` (`is_superadmin = true`). Database policies grant read access to org records while forbidding message body disclosure. Superadmin action audit events are strictly recorded with `audit_superadmin_insert`.

## Hardening & Production Readiness (M7)
- **Account Lockout & Brute-Force Protection:** Distributed rate-limiting and failure tracking in Redis (`auth:fails:{email}`). After 5 consecutive invalid login attempts, account authentication is locked for 15 minutes (`auth:lockout:{email}`, HTTP 429 `AccountLockedError`). Both failure counters and lockout flags are cleared on successful login.
- **Production Security Headers:** HSTS (`Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`) and Content Security Policy (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; frame-ancestors 'none';`) emitted automatically in production mode.
- **Ingress Isolation & Rate Limiting:** Production Nginx config applies separate IP-based burst rate-limiting zones (`api_limit` at 30r/s, `auth_limit` at 5r/s), strictly blocks external calls to `/api/v1/internal/` (HTTP 403), disables chunk buffering on `/api/v1/events/stream` for reliable Server-Sent Events, and limits upload payload sizes to 20MB.
- **Production Startup Guards:** Strict environment validations prevent server initialization in production if default/insecure keys are detected (`JWT_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, insecure cookies, or simulator flags enabled).
- **Disaster Recovery & Integrity:** Database backup automation with compressed format (`pg_dump -Fc`), SHA-256 verification hashes, and 7-day automated rotation. Restoration runbook with connection termination and RBAC re-syncing.

## Planned (Later)
- MFA (TOTP), WhatsApp session data encryption (RemoteAuth store), dependency and container scanning in CI.
