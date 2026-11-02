"""Node registry: the single source of truth for every workflow node type.

Each node declares its category, configuration fields (used both to validate configs on the
server and to render the builder's settings form), its output handles (branches) and what it
needs from the run (a conversation, a contact). Nodes are fixed, typed operations: there is no
node that runs user-supplied code (see docs/WORKFLOW_ENGINE.md).
"""

import re
from dataclasses import dataclass, field
from datetime import time
from typing import Any, Literal

FieldType = Literal[
    "text",
    "textarea",
    "number",
    "select",
    "multiselect",
    "keywords",
    "tag",
    "user",
    "connection",
    "time",
    "credential",
]


@dataclass(frozen=True)
class FieldDef:
    key: str
    label: str
    type: FieldType
    required: bool = False
    help: str = ""
    options: tuple[tuple[str, str], ...] = ()  # (value, label)
    default: Any = None
    min: float | None = None
    max: float | None = None
    max_length: int = 1000
    templated: bool = False  # supports {{variables}}


@dataclass(frozen=True)
class NodeDef:
    type: str
    category: Literal["trigger", "condition", "action", "data", "logic", "human"]
    label: str
    description: str
    fields: tuple[FieldDef, ...] = ()
    outputs: tuple[tuple[str, str], ...] = (("out", "Next"),)  # (handle, label)
    needs_conversation: bool = False
    needs_contact: bool = False
    # Trigger only: whether runs started by it carry a conversation / contact.
    provides_conversation: bool = False
    provides_contact: bool = False
    side_effects: bool = False  # skipped (described instead) in test runs
    extra: dict[str, Any] = field(default_factory=dict)


DAYS = (
    ("mon", "Mon"),
    ("tue", "Tue"),
    ("wed", "Wed"),
    ("thu", "Thu"),
    ("fri", "Fri"),
    ("sat", "Sat"),
    ("sun", "Sun"),
)
FIELD_PATHS = (
    ("message.text", "Message text"),
    ("contact.name", "Contact name"),
    ("contact.phone", "Contact phone"),
    ("contact.email", "Contact email"),
    ("contact.company", "Contact company"),
    ("conversation.status", "Conversation status"),
    ("conversation.priority", "Conversation priority"),
    ("variables.value", "Variable: value"),
)
OPERATORS = (
    ("equals", "equals"),
    ("not_equals", "does not equal"),
    ("contains", "contains"),
    ("not_contains", "does not contain"),
    ("starts_with", "starts with"),
    ("is_empty", "is empty"),
    ("is_not_empty", "is not empty"),
    ("greater_than", "is greater than"),
    ("less_than", "is less than"),
)
STATUSES = (("OPEN", "Open"), ("PENDING", "Pending"), ("RESOLVED", "Resolved"))
PRIORITIES = (("low", "Low"), ("normal", "Normal"), ("high", "High"), ("urgent", "Urgent"))
STAGES = (("NEW", "New"), ("QUALIFIED", "Qualified"), ("CONTACTED", "Contacted"), ("PROPOSAL", "Proposal"),
          ("NEGOTIATION", "Negotiation"))  # fmt: skip

NODE_TYPES: tuple[NodeDef, ...] = (
    # --- Triggers --------------------------------------------------------------------
    NodeDef(
        "trigger.message_received", "trigger", "WhatsApp message received",
        "Starts when a customer sends a message. Optionally only for certain words or one channel.",
        fields=(
            FieldDef("keywords", "Only if the message contains", "keywords",
                     help="Leave empty to start on every message. Matching ignores case."),
            FieldDef("match", "Match", "select", default="any",
                     options=(("any", "Any of the words"), ("all", "All of the words"), ("exact", "Exactly one of them"))),
            FieldDef("connection_id", "Channel", "connection", help="Leave empty for all channels."),
        ),
        provides_conversation=True, provides_contact=True,
    ),
    NodeDef("trigger.new_conversation", "trigger", "New conversation",
            "Starts on the first message of a new conversation.",
            fields=(FieldDef("connection_id", "Channel", "connection", help="Leave empty for all channels."),),
            provides_conversation=True, provides_contact=True),
    NodeDef("trigger.new_contact", "trigger", "New contact",
            "Starts when someone messages you for the first time.",
            provides_conversation=True, provides_contact=True),
    NodeDef("trigger.manual", "trigger", "Manual",
            "Started by a team member, optionally for a chosen conversation.",
            provides_conversation=True, provides_contact=True, extra={"conversation_optional": True}),
    NodeDef("trigger.webhook", "trigger", "Webhook",
            "Starts when another system calls this workflow's secret URL with JSON. "
            "Data is available as {{webhook.<field>}}."),
    NodeDef(
        "trigger.schedule", "trigger", "On a schedule",
        "Runs at the times set on the Schedules page — once, or for each contact with a tag.",
        # Timing lives on the schedule (one workflow can have several). Runs for tagged contacts
        # carry the contact and their latest conversation; a plain schedule run carries neither.
        provides_conversation=True, provides_contact=True,
        extra={"conversation_optional": True},
    ),
    # --- Conditions ------------------------------------------------------------------
    NodeDef(
        "condition.compare", "condition", "If / else",
        "Checks a value and continues on Yes or No.",
        fields=(
            FieldDef("field", "Value", "select", required=True, options=FIELD_PATHS, default="message.text"),
            FieldDef("variable", "Variable name", "text", help="Only for “Variable”. Letters, digits, underscore.",
                     max_length=40),
            FieldDef("operator", "Check", "select", required=True, options=OPERATORS, default="contains"),
            FieldDef("value", "Compare with", "text", max_length=500),
        ),
        outputs=(("true", "Yes"), ("false", "No")),
    ),
    NodeDef("condition.keywords", "condition", "Keyword match",
            "Branches on whether the latest customer message contains any of the words.",
            fields=(FieldDef("keywords", "Words", "keywords", required=True),),
            outputs=(("true", "Matched"), ("false", "Not matched")), needs_conversation=True),
    NodeDef(
        "condition.business_hours", "condition", "Business hours",
        "Branches on whether it is currently within opening hours (organization timezone).",
        fields=(
            FieldDef("days", "Open on", "multiselect", required=True, options=DAYS,
                     default=["mon", "tue", "wed", "thu", "fri", "sat"]),
            FieldDef("start", "Opens", "time", required=True, default="09:00"),
            FieldDef("end", "Closes", "time", required=True, default="18:00"),
        ),
        outputs=(("true", "Open"), ("false", "Closed")),
    ),
    NodeDef("condition.has_tag", "condition", "Contact has tag", "Branches on a contact tag.",
            fields=(FieldDef("tag_id", "Tag", "tag", required=True),),
            outputs=(("true", "Has tag"), ("false", "Doesn't")), needs_contact=True),
    # --- Actions ---------------------------------------------------------------------
    NodeDef("action.send_message", "action", "Send WhatsApp message",
            "Replies in the conversation. Respects opt-outs, human takeover and sending limits.",
            fields=(FieldDef("text", "Message", "textarea", required=True, max_length=4096, templated=True,
                             help="Use {{contact.name}}, {{message.text}} or {{variables.<name>}}."),),
            needs_conversation=True, side_effects=True),
    NodeDef("action.add_tag", "action", "Add tag", "Adds a tag to the contact.",
            fields=(FieldDef("tag_id", "Tag", "tag", required=True),), needs_contact=True, side_effects=True),
    NodeDef("action.remove_tag", "action", "Remove tag", "Removes a tag from the contact.",
            fields=(FieldDef("tag_id", "Tag", "tag", required=True),), needs_contact=True, side_effects=True),
    NodeDef("action.assign", "action", "Assign conversation", "Assigns the conversation to a team member.",
            fields=(FieldDef("user_id", "Assign to", "user", required=True),),
            needs_conversation=True, side_effects=True),
    NodeDef("action.set_status", "action", "Set conversation status", "Changes the conversation status.",
            fields=(FieldDef("status", "Status", "select", required=True, options=STATUSES, default="PENDING"),),
            needs_conversation=True, side_effects=True),
    NodeDef("action.set_priority", "action", "Set priority", "Changes the conversation priority.",
            fields=(FieldDef("priority", "Priority", "select", required=True, options=PRIORITIES, default="high"),),
            needs_conversation=True, side_effects=True),
    NodeDef("action.add_note", "action", "Add internal note", "Leaves a note for the team on the conversation.",
            fields=(FieldDef("body", "Note", "textarea", required=True, max_length=2000, templated=True),),
            needs_conversation=True, side_effects=True),
    NodeDef(
        "action.create_lead", "action", "Create lead", "Adds a lead for the contact to the pipeline.",
        fields=(
            FieldDef("title", "Title", "text", required=True, max_length=200, templated=True,
                     default="Enquiry from {{contact.name}}"),
            FieldDef("stage", "Stage", "select", options=STAGES, default="NEW"),
            FieldDef("value", "Value", "number", min=0, max=999999999999),
            FieldDef("owner_user_id", "Owner", "user"),
        ),
        needs_contact=True, side_effects=True,
    ),
    NodeDef(
        "action.create_task", "action", "Create follow-up task", "Creates a task for the team.",
        fields=(
            FieldDef("title", "Title", "text", required=True, max_length=200, templated=True,
                     default="Follow up with {{contact.name}}"),
            FieldDef("due_in_hours", "Due in (hours)", "number", min=0, max=8760, default=24),
            FieldDef("assignee_user_id", "Assignee", "user"),
        ),
        side_effects=True,
    ),
    NodeDef(
        "action.http_request", "action", "HTTP request",
        "Calls an external webhook or API endpoint with SSRF protection and optional credential.",
        fields=(
            FieldDef("url", "URL", "text", required=True, max_length=1000, templated=True,
                     help="Target URL (HTTPS/HTTP). Internal and private IP addresses are blocked."),
            FieldDef("method", "Method", "select", required=True, default="POST",
                     options=(("GET", "GET"), ("POST", "POST"), ("PUT", "PUT"), ("PATCH", "PATCH"), ("DELETE", "DELETE"))),
            FieldDef("headers", "Headers (JSON)", "textarea", max_length=2000, templated=True,
                     help="Optional JSON dictionary of headers."),
            FieldDef("body", "Request Body", "textarea", max_length=10000, templated=True,
                     help="Request payload (text or JSON)."),
            FieldDef("credential_id", "Credential", "credential",
                     help="Optional saved credential (Integrations → Credentials). Bearer and API-key "
                          "credentials are sent as Authorization: Bearer … and X-API-Key, basic as Basic auth."),
            FieldDef("timeout_seconds", "Timeout (seconds)", "number", min=1, max=30, default=10),
        ),
        side_effects=True,
    ),
    # --- Data ------------------------------------------------------------------------
    NodeDef("data.set_variable", "data", "Set variable",
            "Stores a value for later steps as {{variables.<name>}}.",
            fields=(FieldDef("name", "Name", "text", required=True, max_length=40,
                             help="Letters, digits and underscore."),
                    FieldDef("value", "Value", "text", max_length=1000, templated=True))),
    # --- Logic -----------------------------------------------------------------------
    NodeDef("logic.delay", "logic", "Delay", "Waits before continuing (durable: survives restarts).",
            fields=(FieldDef("amount", "Wait", "number", required=True, min=1, max=10000, default=10),
                    FieldDef("unit", "Unit", "select", required=True, default="minutes",
                             options=(("minutes", "Minutes"), ("hours", "Hours"), ("days", "Days"))))),
    NodeDef("logic.wait_for_reply", "logic", "Wait for reply",
            "Waits for the customer's next message, up to a time limit.",
            fields=(FieldDef("timeout_minutes", "Give up after (minutes)", "number", required=True,
                             min=1, max=43200, default=60),),
            outputs=(("replied", "Replied"), ("timeout", "No reply")), needs_conversation=True),
    NodeDef("logic.stop", "logic", "Stop", "Ends the workflow.", outputs=()),
    # --- Human -----------------------------------------------------------------------
    NodeDef(
        "human.approval", "human", "Request approval",
        "Pauses until a team member approves or rejects (Execution logs → Approvals).",
        fields=(
            FieldDef("title", "What needs approval", "text", required=True, max_length=200, templated=True),
            FieldDef("details", "Details", "textarea", max_length=2000, templated=True),
            FieldDef("assignee_user_id", "Ask", "user", help="Anyone with approval rights can decide."),
            FieldDef("timeout_hours", "Expire after (hours)", "number", required=True, min=1, max=720, default=24),
        ),
        outputs=(("approved", "Approved"), ("rejected", "Rejected"), ("timeout", "Expired")),
    ),
    NodeDef(
        "human.handover", "human", "Hand over to a person",
        "Pauses automations for this conversation and assigns it. The workflow ends here.",
        fields=(FieldDef("user_id", "Assign to", "user"),
                FieldDef("note", "Note for the team", "text", max_length=500, templated=True)),
        outputs=(), needs_conversation=True, side_effects=True,
    ),
)  # fmt: skip

REGISTRY: dict[str, NodeDef] = {n.type: n for n in NODE_TYPES}
TRIGGER_TYPES = frozenset(n.type for n in NODE_TYPES if n.category == "trigger")

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")


class ConfigError(ValueError):
    pass


def validate_config(node: NodeDef, config: dict[str, Any]) -> dict[str, Any]:
    """Returns a cleaned config containing only declared fields; raises ConfigError on bad input."""
    if not isinstance(config, dict):
        raise ConfigError("Settings must be an object")
    clean: dict[str, Any] = {}
    for f in node.fields:
        value = config.get(f.key, f.default)
        empty = value is None or value == "" or value == []
        if empty:
            if f.required:
                raise ConfigError(f"{f.label} is required")
            continue
        match f.type:
            case "text" | "textarea" | "tag" | "user" | "connection" | "credential":
                if not isinstance(value, str):
                    raise ConfigError(f"{f.label} must be text")
                value = value.strip()
                if len(value) > f.max_length:
                    raise ConfigError(f"{f.label} is too long (max {f.max_length})")
            case "number":
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    try:
                        value = float(value)
                    except (TypeError, ValueError) as exc:
                        raise ConfigError(f"{f.label} must be a number") from exc
                if f.min is not None and value < f.min or f.max is not None and value > f.max:
                    raise ConfigError(f"{f.label} must be between {f.min:g} and {f.max:g}")
            case "select":
                if value not in {o[0] for o in f.options}:
                    raise ConfigError(f"{f.label}: choose one of the options")
            case "multiselect":
                allowed = {o[0] for o in f.options}
                if not isinstance(value, list) or not value or any(v not in allowed for v in value):
                    raise ConfigError(f"{f.label}: choose at least one option")
            case "keywords":
                if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
                    raise ConfigError(f"{f.label} must be a list of words")
                value = [v.strip() for v in value if v.strip()][:50]
                if f.required and not value:
                    raise ConfigError(f"{f.label} is required")
            case "time":
                try:
                    time.fromisoformat(str(value))
                except ValueError as exc:
                    raise ConfigError(f"{f.label}: use HH:MM") from exc
        clean[f.key] = value
    if node.type == "data.set_variable" and not _IDENT.match(clean.get("name", "")):
        raise ConfigError("Variable name: letters, digits and underscore only")
    if node.type == "condition.compare" and clean.get("field") == "variables.value":
        if not _IDENT.match(clean.get("variable", "")):
            raise ConfigError("Variable name: letters, digits and underscore only")
    return clean


def describe() -> list[dict[str, Any]]:
    """Registry as JSON for the builder (palette + settings forms)."""
    return [
        {
            "type": n.type,
            "category": n.category,
            "label": n.label,
            "description": n.description,
            "outputs": [{"handle": h, "label": label} for h, label in n.outputs],
            "needs_conversation": n.needs_conversation,
            "needs_contact": n.needs_contact,
            "side_effects": n.side_effects,
            "fields": [
                {
                    "key": f.key, "label": f.label, "type": f.type, "required": f.required, "help": f.help,
                    "options": [{"value": v, "label": label} for v, label in f.options],
                    "default": f.default, "min": f.min, "max": f.max, "max_length": f.max_length,
                    "templated": f.templated,
                }
                for f in n.fields
            ],
        }
        for n in NODE_TYPES
    ]  # fmt: skip
