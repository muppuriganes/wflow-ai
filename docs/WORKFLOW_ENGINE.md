# Workflow engine (M4)

Visual automations that react to WhatsApp messages, new contacts, webhooks or a button press, executed
durably on [Temporal](https://temporal.io).

## Pieces

| Piece | Where | Role |
|---|---|---|
| Node registry | `backend/app/workflow_engine/nodes.py` | The single list of step types: category, settings fields, outputs (branches), what each needs. Drives server validation **and** the builder's palette/settings forms (`GET /workflow-node-types`). |
| Graph compiler | `workflow_engine/graph.py` | Validates the React Flow graph and compiles it into a small execution plan. |
| Expressions | `workflow_engine/expressions.py` | `{{path}}` substitution, comparisons, keyword matching, business hours. Data only — no code evaluation. |
| Temporal workflow | `workflow_engine/workflow.py` (`WFlowGraph`) | Walks the plan; owns delays, waits and approvals (durable timers/signals). Deterministic: every side effect is an activity. |
| Activities | `workflow_engine/activities.py`, `actions.py` | Read context, run actions (send, tag, assign, lead, task, note…), record each step. Idempotent. |
| Triggers | `workflow_engine/triggers.py` | Start runs from inbound messages (channel worker), manual runs, webhooks; resume runs waiting for a reply. |
| Worker | `app/workers/workflow_worker.py` | `python -m app.workers.workflow_worker` — hosts the workflow and activities. |
| UI | `frontend/src/modules/workflows`, `modules/executions` | List, builder (React Flow), test runs, versions; Execution Logs and Approvals. |

## Lifecycle

1. **Draft** — the builder autosaves the graph (`PATCH /workflows/{id}`) and re-validates it. Moving
   cards does not count as a change.
2. **Test** — `POST /workflows/{id}/test` compiles the *draft* and runs it as a **dry run** on a chosen
   conversation: actions only describe what they would do (“Would send: …”), delays/waits/approvals are
   skipped. Results overlay the canvas.
3. **Publish** — validates (graph + that referenced tags, members and numbers exist), stores an
   immutable `workflow_versions` row with the definition and compiled plan, and activates the workflow.
   Runs always execute the version they started with.
4. **Pause / activate / archive** — paused workflows start no new runs; their webhook returns 404.
5. **Restore** — copies an older version into the draft; it goes live only when published again.

## Validation rules

Exactly one trigger; nothing connects into it; only existing output handles; no loops (graphs are
acyclic in this version); at most 100 steps; steps that need a conversation/contact must sit under a
trigger that provides one. Unreachable steps and branching steps with an unconnected outcome are
warnings.

## Execution semantics

- One Temporal workflow per run, id `wfr-<run_id>`, started with *reject duplicate*.
- Inbound message events are de-duplicated per workflow by `trigger_event_key = msg:<message_id>`
  (unique index), so stream redelivery never starts a second run. Webhooks use `hook:<Idempotency-Key>`.
- A workflow with an active run on a conversation doesn't start another one there. A customer reply
  goes to a run that is **waiting for a reply** instead of starting new runs.
- **Human takeover** (`conversations.automation_paused`, set by the *Hand over to a person* step or the
  inbox) stops triggers and makes automated sends fail as skipped.
- Activities retry 5× with backoff (2 s → 1 min). Each step is recorded once per run in `node_runs`
  (unique `(run_id, node_id)`); a completed step is never executed twice, and sends use a deterministic
  `client_message_id`, so retries don't double-send.
- A step that fails after its retries fails the run with the error; **Retry** starts a new run with the
  same trigger input. **Cancel** stops a run; steps still waiting are marked cancelled.
- Sends respect opt-outs, customer-initiated rules and per-number limits (shared with the inbox).

## Step catalogue (24)

Triggers: message received (keywords any/all/exact phrase, optional number), new conversation, new
contact, manual, webhook. Conditions: compare a value, keyword match, business hours (org timezone),
contact has tag. Actions: send message, add/remove tag, assign, set status, set priority, internal note,
create lead, create follow-up task. Data: set variable. Flow: delay, wait for reply (replied / timeout),
stop. People: request approval (approved / rejected / timeout), hand over to a person.

## Webhooks

`POST /api/v1/hooks/{token}` with a JSON object (≤ 64 KB), 60 requests/min per token. The token is the
credential; regenerate it from the builder. Values are available as `{{webhook.<field>}}`; secret-looking
keys are masked in run logs.

## Local development

```bash
docker compose up -d                              # includes temporal (gRPC 57233, UI http://localhost:58233)
cd backend && uv run python -m app.workers.workflow_worker
```

Tests run real workflows against the same dev server on a unique task queue, with
`WORKFLOW_TIME_SCALE=0.0005` compressing hours into seconds (production requires 1.0).

## Not yet

Loops, parallel branches that join, schedules (M5), templates (M5), integrations/HTTP steps (M6),
AI steps (AI track).
