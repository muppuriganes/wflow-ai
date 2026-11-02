import type { TemplateCreateInput, WorkflowDetail, WorkflowTemplate } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}/workflow-templates`;

export const templatesApi = {
  list: (orgId: string, category?: string) => {
    const q = category ? `?category=${encodeURIComponent(category)}` : "";
    return api<WorkflowTemplate[]>(`${base(orgId)}${q}`);
  },
  get: (orgId: string, id: string) => api<WorkflowTemplate>(`${base(orgId)}/${id}`),
  create: (orgId: string, data: TemplateCreateInput) =>
    api<WorkflowTemplate>(base(orgId), { method: "POST", body: data }),
  delete: (orgId: string, id: string) =>
    api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
  instantiate: (orgId: string, id: string) =>
    api<WorkflowDetail>(`${base(orgId)}/${id}/instantiate`, { method: "POST" }),
};

