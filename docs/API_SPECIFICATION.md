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

### Internal (service-to-service, `Authorization: Bearer INTERNAL_API_TOKEN`, not in OpenAPI)
| Method | Path | |
|---|---|---|
| GET | `/internal/channels/restore` | Connections the gateway should resume after a restart |

### Messaging gateway internal API (port 8200, never public)
`GET /health` · `GET /v1/connections` · `POST /v1/connections/{id}/start|stop|logout|remove|messages` ·
`POST /v1/simulator/{id}/scan|inbound` (only when `SIMULATOR_ENABLED`).

## Endpoints (M3) — all under `/organizations/{id}`

### Inbox
| Method | Path | Permission / notes |
|---|---|---|
| GET | `/conversations?view=active\|mine\|unassigned\|resolved\|archived\|all&q=&connection_id=&tag_id=&priority=` | `inbox.read` (paginated) |
| GET | `/inbox/counts` · `/inbox/assignees` | `inbox.read` |
| GET | `/conversations/{c}` | `inbox.read` |
| POST | `/conversations/{c}/assign` `{user_id\|null}` | self-claim: `inbox.reply`; otherwise `inbox.assign`; assignee must be able to read the inbox |
| POST | `/conversations/{c}/status` · `/priority` · `/takeover` | `inbox.reply` |
| GET / POST | `/conversations/{c}/notes` | read / `inbox.reply` |
| GET | `/conversations/{c}/assignments` | `inbox.read` |
| GET | `/conversations/{c}/messages` | `inbox.read` (clears unread; includes attachments, sender) |
| POST | `/conversations/{c}/messages` `{text, client_message_id}` | `inbox.reply`; 409 `contact_opted_out` / `not_customer_initiated` / `connection_not_ready`; 429 |
| POST | `/conversations/{c}/attachments` (multipart `file`, `client_message_id`, `caption?`) | `inbox.reply`; ≤16 MB; 400 `unsupported_file_type` |
| GET | `/attachments/{a}/url` | `inbox.read`; 5-minute signed link |
| GET | `/events/stream` | `inbox.read`; Server-Sent Events, `event: change` with `{type, …ids}`; closes at access-token lifetime |
| GET / POST / PATCH / DELETE | `/tags`, `/tags/{t}` | read `contacts.read`; write `contacts.manage` |
| PUT | `/contacts/{id}/tags` `[tag ids]` | `contacts.manage` |

### CRM
| Method | Path | Permission / notes |
|---|---|---|
| GET / POST | `/custom-fields?entity=contact\|lead` | read `contacts.read`; create/update `org.update` |
| PATCH | `/custom-fields/{f}` | `org.update` (label, options, required, archived) |
| GET / POST | `/contacts?q=&tag_id=` | `contacts.read` / `contacts.manage`; 409 `contact_exists` with `details.contact_id` |
| GET / PATCH / DELETE | `/contacts/{id}` | detail includes conversations, leads, tasks; delete is soft |
| POST | `/contacts/{id}/consent` `{opted_out}` | `contacts.manage` |
| GET / POST | `/contacts/{id}/activities` | timeline; POST adds a note |
| GET | `/leads?owner=me\|unassigned&q=&contact_id=` | `leads.read`; returns `{items, stages: [{stage, count, total_value}]}` |
| POST / PATCH / DELETE | `/leads`, `/leads/{id}` | `leads.manage`; owner must be a member |
| GET | `/tasks?scope=mine\|all&status=open\|done\|all&due=overdue\|today\|upcoming&tz_offset=` | `contacts.read` |
| POST / PATCH / DELETE | `/tasks`, `/tasks/{id}` | `contacts.manage`; `due_at` must include a timezone offset |

### Internal (gateway → backend)
| POST | `/internal/channels/media` (multipart `organization_id`, `connection_id`, `file`) | Stores inbound media, returns `attachment_id` |
|---|---|---|

## Endpoints (M4) — all under `/organizations/{id}` unless noted

### Workflows
| Method | Path | Notes |
|---|---|---|
| GET | `/workflow-node-types` | Step catalogue: category, fields, outputs (drives the builder) |
| GET / POST | `/workflows?include_archived=` | `workflows.read` / `workflows.manage`; list includes 7-day run stats |
| GET / PATCH | `/workflows/{id}` | Draft definition (`{nodes, edges}`), name, description; `webhook_url` only for `workflows.publish` |
| POST | `/workflows/{id}/validate` | `{ok, errors, warnings}` (issues carry `node_id`) |
| POST | `/workflows/{id}/publish` | `workflows.publish`; returns `{workflow, validation}` — nothing is published when invalid |
| POST | `/workflows/{id}/status` `{status: active\|paused\|archived}` | `workflows.publish` |
| POST | `/workflows/{id}/duplicate`, `/workflows/{id}/webhook/regenerate` | |
| GET | `/workflows/{id}/versions`; POST `/versions/{vid}/restore` | Restore copies into the draft |
| POST | `/workflows/{id}/test` `{conversation_id?, sample_message?, webhook?}` | Dry run of the draft; returns `{run, validation}` |
| POST | `/workflows/{id}/execute` `{conversation_id?}` | Manual trigger, published + active only; 409 `human_takeover` |

### Runs and approvals
| Method | Path | Notes |
|---|---|---|
| GET | `/workflow-runs?workflow_id=&status=&include_tests=&page=` | `executions.read` |
| GET | `/workflow-runs/{id}` | Steps with input/output, trigger payload (secrets masked) |
| POST | `/workflow-runs/{id}/retry`, `/workflow-runs/{id}/cancel` | `executions.manage`; retry only for failed/cancelled/timed-out live runs |
| GET | `/approvals?status=` | `executions.read` |
| POST | `/approvals/{id}/decision` `{decision: approved\|rejected, note?}` | `approvals.decide`; 409 if already decided |

### Public webhook trigger (no auth; the token is the credential)
| POST | `/api/v1/hooks/{token}` | JSON object ≤ 64 KB; optional `Idempotency-Key`; 60/min per token; 202 `{status: accepted\|duplicate, run_id}` |
|---|---|---|
