import { useQuery } from "@tanstack/react-query";
import { GitBranch, type LucideIcon, Play, Timer, UserCheck, Variable, Zap } from "lucide-react";
import type { BadgeTone } from "@/components/ui/badge";
import { channelsApi } from "@/services/channels";
import { inboxApi } from "@/services/inbox";
import { integrationsApi } from "@/services/integrations";
import { orgApi } from "@/services/organizations";
import { workflowsApi } from "@/services/workflows";
import { orgKeys } from "@/stores/organization";
import type { NodeCategory, NodeType, RunStatus, WorkflowStatus } from "@/types/api";

export const CATEGORIES: Record<NodeCategory, { label: string; icon: LucideIcon; accent: string }> = {
  trigger: { label: "Triggers", icon: Zap, accent: "bg-primary-soft text-primary" },
  condition: { label: "Conditions", icon: GitBranch, accent: "bg-warning-soft text-warning" },
  action: { label: "Actions", icon: Play, accent: "bg-info-soft text-info" },
  data: { label: "Data", icon: Variable, accent: "bg-surface-muted text-muted" },
  logic: { label: "Flow control", icon: Timer, accent: "bg-success-soft text-success" },
  human: { label: "People", icon: UserCheck, accent: "bg-danger-soft text-danger" },
};

export const CATEGORY_ORDER: NodeCategory[] = ["trigger", "condition", "action", "data", "logic", "human"];

export const WORKFLOW_STATUS: Record<WorkflowStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  archived: { label: "Archived", tone: "neutral" },
};

export const RUN_STATUS: Record<RunStatus, { label: string; tone: BadgeTone }> = {
  QUEUED: { label: "Queued", tone: "neutral" },
  RUNNING: { label: "Running", tone: "info" },
  WAITING: { label: "Waiting", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  TIMED_OUT: { label: "Timed out", tone: "danger" },
};

export const NODE_RUN_TONE: Record<string, BadgeTone> = {
  running: "info",
  waiting: "warning",
  completed: "success",
  skipped: "neutral",
  failed: "danger",
  cancelled: "neutral",
};

export const WAITING_LABEL: Record<string, string> = {
  delay: "Waiting for a delay",
  reply: "Waiting for the customer to reply",
  approval: "Waiting for approval",
};

export function formatDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ${m % 60} min` : `${Math.floor(h / 24)} days`;
}

/** The step catalogue rarely changes: fetched once per session. */
export function useNodeTypes(orgId: string) {
  return useQuery({
    queryKey: orgKeys.scoped(orgId, "workflow-node-types"),
    queryFn: () => workflowsApi.nodeTypes(orgId),
    staleTime: Infinity,
    select: (types) => new Map(types.map((t) => [t.type, t])),
  });
}

export type Lookups = {
  tags: { value: string; label: string }[];
  users: { value: string; label: string }[];
  connections: { value: string; label: string }[];
  credentials: { value: string; label: string }[];
};

/** Names for the tag / team member / WhatsApp number pickers in step settings. */
export function useLookups(orgId: string): Lookups {
  const tags = useQuery({ queryKey: orgKeys.scoped(orgId, "tags"), queryFn: () => inboxApi.tags(orgId) });
  const members = useQuery({ queryKey: orgKeys.scoped(orgId, "members"), queryFn: () => orgApi.members(orgId) });
  const connections = useQuery({ queryKey: orgKeys.scoped(orgId, "connections"), queryFn: () => channelsApi.list(orgId) });
  const credentials = useQuery({
    queryKey: orgKeys.scoped(orgId, "credentials"),
    queryFn: () => integrationsApi.listCredentials(orgId),
    // Only people who can see integrations get the list; others see the saved choice as "Unknown".
    retry: false,
  });
  return {
    tags: (tags.data ?? []).map((t) => ({ value: t.id, label: t.name })),
    users: (members.data ?? []).map((m) => ({ value: m.user_id, label: m.full_name || m.email })),
    connections: (connections.data ?? []).map((c) => ({ value: c.id, label: c.display_name })),
    credentials: (credentials.data ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.type})` })),
  };
}

/** One line describing a step's settings, shown on the canvas card. */
export function summarize(def: NodeType, config: Record<string, unknown>, lookups: Lookups): string {
  for (const field of def.fields) {
    const value = config[field.key];
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    const pick = (list: { value: string; label: string }[]) => list.find((o) => o.value === value)?.label ?? "Unknown";
    switch (field.type) {
      case "keywords":
      case "multiselect":
        return (value as string[])
          .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
          .join(", ");
      case "select":
        return `${field.label}: ${field.options.find((o) => o.value === value)?.label ?? String(value)}`;
      case "tag":
        return `Tag: ${pick(lookups.tags)}`;
      case "user":
        return `${field.label}: ${pick(lookups.users)}`;
      case "connection":
        return `Number: ${pick(lookups.connections)}`;
      case "credential":
        return `Credential: ${pick(lookups.credentials)}`;
      case "number":
        if (def.type === "logic.delay") return `${String(value)} ${String(config.unit ?? "minutes")}`;
        return `${field.label}: ${String(value)}`;
      default:
        return String(value);
    }
  }
  return def.fields.length ? "Not configured yet" : def.description;
}

/** Config with each field's default filled in (for a newly added step). */
export function defaultConfig(def: NodeType): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const f of def.fields) if (f.default !== null && f.default !== undefined) config[f.key] = f.default;
  return config;
}
