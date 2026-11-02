"""Source of truth for platform permissions and the built-in organization roles.

`app.cli sync-rbac` upserts these into the database (idempotent). Roles are data, so
organizations can get custom roles later without schema changes.

Super Admin is NOT an organization role: it is the `users.is_superadmin` flag and is
checked by a separate dependency, so it never leaks into organization-level access.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionDef:
    code: str
    category: str
    description: str


PERMISSIONS: tuple[PermissionDef, ...] = (
    PermissionDef("org.read", "organization", "View organization details"),
    PermissionDef("org.update", "organization", "Edit organization profile and settings"),
    PermissionDef("org.delete", "organization", "Delete the organization"),
    PermissionDef("members.read", "team", "View team members"),
    PermissionDef("members.invite", "team", "Invite people to the organization"),
    PermissionDef("members.update", "team", "Change member roles"),
    PermissionDef("members.remove", "team", "Remove members"),
    PermissionDef("roles.read", "team", "View roles and permissions"),
    PermissionDef("audit.read", "security", "View the audit log"),
    PermissionDef("connections.read", "channels", "View messaging connections"),
    PermissionDef("connections.manage", "channels", "Add, link and remove messaging connections"),
    PermissionDef("inbox.read", "inbox", "View conversations"),
    PermissionDef("inbox.reply", "inbox", "Reply to conversations"),
    PermissionDef("inbox.assign", "inbox", "Assign and transfer conversations"),
    PermissionDef("contacts.read", "crm", "View contacts"),
    PermissionDef("contacts.manage", "crm", "Create and edit contacts"),
    PermissionDef("leads.read", "crm", "View leads"),
    PermissionDef("leads.manage", "crm", "Create and edit leads"),
    PermissionDef("workflows.read", "automation", "View workflows"),
    PermissionDef("workflows.manage", "automation", "Create and edit workflows"),
    PermissionDef("workflows.publish", "automation", "Publish workflows"),
    PermissionDef("executions.read", "automation", "View workflow executions"),
    PermissionDef("executions.manage", "automation", "Retry and cancel executions"),
    PermissionDef("approvals.decide", "automation", "Approve or reject pending actions"),
    PermissionDef("schedules.manage", "automation", "Manage schedules"),
    PermissionDef("templates.read", "automation", "Browse templates"),
    PermissionDef("templates.manage", "automation", "Publish private templates"),
    PermissionDef("integrations.read", "integrations", "View integrations"),
    PermissionDef("integrations.manage", "integrations", "Configure integrations and credentials"),
    PermissionDef("analytics.read", "analytics", "View dashboards and analytics"),
    PermissionDef("billing.read", "billing", "View plan and invoices"),
    PermissionDef("billing.manage", "billing", "Change plan and billing details"),
)

ALL_PERMISSION_CODES = frozenset(p.code for p in PERMISSIONS)


@dataclass(frozen=True)
class RoleDef:
    key: str
    name: str
    description: str
    # Higher rank = more authority. A member may only grant roles ranked at or below their own.
    rank: int
    permissions: frozenset[str]


def _without(*codes: str) -> frozenset[str]:
    return ALL_PERMISSION_CODES - frozenset(codes)


_READ_ONLY = frozenset(
    {
        "org.read",
        "members.read",
        "roles.read",
        "connections.read",
        "inbox.read",
        "contacts.read",
        "leads.read",
        "workflows.read",
        "executions.read",
        "templates.read",
        "integrations.read",
        "analytics.read",
    }
)

SYSTEM_ROLES: tuple[RoleDef, ...] = (
    RoleDef(
        "owner",
        "Organization Owner",
        "Full control, including billing and deletion",
        100,
        ALL_PERMISSION_CODES,
    ),
    RoleDef(
        "admin",
        "Organization Admin",
        "Manages team, settings and all modules",
        80,
        _without("org.delete", "billing.manage"),
    ),
    RoleDef(
        "manager",
        "Manager",
        "Runs day-to-day operations, inbox, CRM and approvals",
        60,
        _READ_ONLY
        | {
            "inbox.reply",
            "inbox.assign",
            "contacts.manage",
            "leads.manage",
            "approvals.decide",
            "executions.manage",
            "members.invite",
            "audit.read",
            "schedules.manage",
        },
    ),
    RoleDef(
        "automation_developer",
        "Automation Developer",
        "Builds and publishes workflows",
        50,
        _READ_ONLY
        | {
            "workflows.manage",
            "workflows.publish",
            "executions.manage",
            "schedules.manage",
            "templates.manage",
            "integrations.manage",
            "connections.manage",
        },
    ),
    RoleDef(
        "agent_operator",
        "Agent Operator",
        "Handles customer conversations",
        40,
        frozenset(
            {
                "org.read",
                "members.read",
                "inbox.read",
                "inbox.reply",
                "contacts.read",
                "contacts.manage",
                "leads.read",
                "leads.manage",
                "templates.read",
            }
        ),
    ),
    RoleDef("viewer", "Viewer", "Read-only access", 10, _READ_ONLY),
)

ROLE_KEYS = frozenset(r.key for r in SYSTEM_ROLES)
OWNER_ROLE_KEY = "owner"
