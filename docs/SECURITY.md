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

## Planned
- CSP for the SPA (with nginx in production), MFA (TOTP), account lockout after repeated failures,
  credential encryption at rest for integrations and WhatsApp session data (M2), consent/opt-out enforcement (M2),
  dependency and container scanning in CI, backup/restore runbook (M7).
