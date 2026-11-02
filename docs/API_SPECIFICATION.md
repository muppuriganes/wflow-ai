# API specification

Base URL `/api/v1`. Interactive OpenAPI docs: `/api/docs` (schema at `/api/openapi.json`).

## Conventions
- JSON bodies, validated by Pydantic. Unknown routes and all errors use:
  `{"error": {"code": "...", "message": "...", "details": ..., "request_id": "..."}}`.
  Validation errors (`422`, `validation_error`) list `{field, message}` items in `details`.
- Auth: `Authorization: Bearer <access_token>`. Refresh token: `wflow_rt` cookie (httpOnly, path `/api/v1/auth`).
- Lists that can grow are paginated: `?page=&page_size=` → `{items, total, page, page_size}`.
- Organization-scoped resources live under `/organizations/{org_id}/…`. Non-members receive `404`.
- `X-Request-ID` is returned on every response (and accepted from clients for tracing).
- Auth endpoints are rate limited per IP (`429 rate_limited`).

## Endpoints (M1)

### Health
| Method | Path | |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/health/ready` | DB + Redis checks (503 when degraded) |

### Auth
| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register` | `{email, password, full_name, organization_name?}` → tokens; sets refresh cookie |
| POST | `/auth/login` | `{email, password}` → tokens |
| POST | `/auth/refresh` | Cookie → new tokens (rotation) |
| POST | `/auth/logout` | Revokes current session |
| POST | `/auth/forgot-password` | Always `202` (no account enumeration) |
| POST | `/auth/reset-password` | `{token, password}`; signs out all sessions |
| POST | `/auth/verify-email` | `{token}` |
| POST | `/auth/resend-verification` | Auth required |
| POST | `/auth/change-password` | Keeps current session, ends others |
| GET | `/auth/sessions` | Active sessions, `current` flag |
| DELETE | `/auth/sessions/{id}` | Sign out one session |

### Me
| GET / PATCH | `/me` | Profile |
|---|---|---|
| GET | `/me/activity` | Account-level audit events (paginated) |

### Organizations
| Method | Path | Permission |
|---|---|---|
| GET | `/organizations` | Your orgs with role + permissions |
| POST | `/organizations` | Any user (limit per user) |
| GET | `/organizations/{id}` | member |
| PATCH | `/organizations/{id}` | `org.update` |
| DELETE | `/organizations/{id}` | `org.delete` (soft) |
| GET | `/organizations/{id}/members` | `members.read` |
| PATCH | `/organizations/{id}/members/{member_id}` | `members.update` + rank rules |
| DELETE | `/organizations/{id}/members/{member_id}` | `members.remove` + rank rules (own id = leave) |
| GET | `/organizations/{id}/invitations` | `members.read` |
| POST | `/organizations/{id}/invitations` | `members.invite`; re-inviting replaces the open invite |
| DELETE | `/organizations/{id}/invitations/{inv_id}` | `members.invite` |
| GET | `/organizations/{id}/roles` | `roles.read` |
| GET | `/organizations/{id}/audit-logs` | `audit.read`; `?action=` prefix filter |
| GET | `/permissions` | authenticated |

### Invitations
| POST | `/invitations/preview` | Public; `{token}` → org name, email, role, status |
|---|---|---|
| POST | `/invitations/accept` | Auth; email must match; marks email verified |

## Endpoints (M2)

### Channels — `/organizations/{id}/…`
| Method | Path | Permission |
|---|---|---|
| GET | `/channel-capabilities` | `connections.read` — enabled channel types, limits |
| GET / POST | `/connections` | read / `connections.manage`; `{display_name, channel_type: whatsapp_web or simulator}` |
| GET | `/connections/{cid}` | `connections.read` |
| POST | `/connections/{cid}/initialize`, `/reconnect` | `connections.manage` |
| GET | `/connections/{cid}/qr` | `connections.manage` — `{status, qr_data_url, expires_in}` |
| POST | `/connections/{cid}/logout` | `connections.manage` — unlinks device, deletes session |
| DELETE | `/connections/{cid}` | `connections.manage` — gateway wipe first; 503 if it cannot confirm |
| GET | `/connections/{cid}/events` | `connections.read` — connection log (paginated) |
| POST | `/connections/{cid}/simulate/scan`, `/simulate/inbound` | simulator connections only, dev |
| GET | `/conversations?connection_id=` | `inbox.read` |
| GET | `/conversations/{conv}/messages` | `inbox.read` (clears unread) |
| POST | `/conversations/{conv}/messages` | `inbox.reply`; `{text, client_message_id}`; 409 `contact_opted_out` / `not_customer_initiated` / `connection_not_ready`; 429 over the send limit |

### Internal (service-to-service, `Authorization: Bearer INTERNAL_API_TOKEN`, not in OpenAPI)
| Method | Path | |
|---|---|---|
| GET | `/internal/channels/restore` | Connections the gateway should resume after a restart |

### Messaging gateway internal API (port 8200, never public)
`GET /health` · `GET /v1/connections` · `POST /v1/connections/{id}/start|stop|logout|remove|messages` ·
`POST /v1/simulator/{id}/scan|inbound` (only when `SIMULATOR_ENABLED`).
