import type {
  Approval,
  NodeType,
  Page,
  RunDetail,
  RunStatus,
  RunSummary,
  Validation,
  WorkflowDefinition,
  WorkflowDetail,
  WorkflowSummary,
  WorkflowVersion,
} from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}`;
const wf = (orgId: string, id: string) => `${base(orgId)}/workflows/${id}`;

export type RunFilters = { workflow_id?: string; status?: RunStatus; include_tests?: boolean; page?: number };
export type RunRequest = { conversation_id?: string | null; sample_message?: string | null; webhook?: Record<string, unknown> | null };

function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const workflowsApi = {
  nodeTypes: (orgId: string) => api<NodeType[]>(`${base(orgId)}/workflow-node-types`),
  list: (orgId: string, includeArchived = false) =>
    api<WorkflowSummary[]>(`${base(orgId)}/workflows${query({ include_archived: includeArchived })}`),
  get: (orgId: string, id: string) => api<WorkflowDetail>(wf(orgId, id)),
  create: (orgId: string, data: { name: string; description?: string | null; definition?: WorkflowDefinition }) =>
    api<WorkflowDetail>(`${base(orgId)}/workflows`, { method: "POST", body: data }),
  update: (orgId: string, id: string, data: { name?: string; description?: string | null; definition?: WorkflowDefinition }) =>
    api<WorkflowDetail>(wf(orgId, id), { method: "PATCH", body: data }),
  validate: (orgId: string, id: string) => api<Validation>(`${wf(orgId, id)}/validate`, { method: "POST" }),
  publish: (orgId: string, id: string) =>
    api<{ workflow: WorkflowDetail; validation: Validation }>(`${wf(orgId, id)}/publish`, { method: "POST" }),
  setStatus: (orgId: string, id: string, status: "active" | "paused" | "archived") =>
    api<WorkflowDetail>(`${wf(orgId, id)}/status`, { method: "POST", body: { status } }),
  duplicate: (orgId: string, id: string) => api<WorkflowDetail>(`${wf(orgId, id)}/duplicate`, { method: "POST" }),
  regenerateWebhook: (orgId: string, id: string) => api<WorkflowDetail>(`${wf(orgId, id)}/webhook/regenerate`, { method: "POST" }),
  versions: (orgId: string, id: string) => api<WorkflowVersion[]>(`${wf(orgId, id)}/versions`),
  restoreVersion: (orgId: string, id: string, versionId: string) =>
    api<WorkflowDetail>(`${wf(orgId, id)}/versions/${versionId}/restore`, { method: "POST" }),
  testRun: (orgId: string, id: string, data: RunRequest) =>
    api<{ run: RunSummary | null; validation: Validation }>(`${wf(orgId, id)}/test`, { method: "POST", body: data }),
  execute: (orgId: string, id: string, data: RunRequest) => api<RunSummary>(`${wf(orgId, id)}/execute`, { method: "POST", body: data }),

  runs: (orgId: string, f: RunFilters) =>
    api<Page<RunSummary>>(`${base(orgId)}/workflow-runs${query({ ...f, page_size: 25 })}`),
  run: (orgId: string, id: string) => api<RunDetail>(`${base(orgId)}/workflow-runs/${id}`),
  retryRun: (orgId: string, id: string) => api<RunSummary>(`${base(orgId)}/workflow-runs/${id}/retry`, { method: "POST" }),
  cancelRun: (orgId: string, id: string) => api<RunSummary>(`${base(orgId)}/workflow-runs/${id}/cancel`, { method: "POST" }),

  approvals: (orgId: string, status?: string) => api<Approval[]>(`${base(orgId)}/approvals${query({ status })}`),
  decide: (orgId: string, id: string, decision: "approved" | "rejected", note?: string) =>
    api<Approval>(`${base(orgId)}/approvals/${id}/decision`, { method: "POST", body: { decision, note: note || null } }),
};
