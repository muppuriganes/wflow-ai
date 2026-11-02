import type { Activity, ContactDetail, CrmContact, CustomField, CustomFieldType, Lead, LeadStage, Page, StageSummary, Task } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}`;

function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  const s = search.toString();
  return s ? `?${s}` : "";
}

export type ContactInput = {
  display_name: string;
  phone_number?: string | null;
  email?: string | null;
  company?: string | null;
  custom_fields?: Record<string, unknown>;
};

export type LeadInput = {
  contact_id?: string;
  title?: string;
  stage?: LeadStage;
  position?: number;
  value_amount?: string | null;
  currency?: string;
  source?: string | null;
  score?: number;
  owner_user_id?: string | null;
  expected_close_date?: string | null;
  lost_reason?: string | null;
  custom_fields?: Record<string, unknown>;
};

export type TaskInput = {
  title?: string;
  description?: string | null;
  due_at?: string | null;
  assignee_user_id?: string | null;
  contact_id?: string | null;
  lead_id?: string | null;
  conversation_id?: string | null;
  completed?: boolean;
};

export type TaskFilters = { scope?: "mine" | "all"; status?: "open" | "done" | "all"; due?: "overdue" | "today" | "upcoming"; contact_id?: string; lead_id?: string };

export const crmApi = {
  contacts: (orgId: string, q: string, tagId: string | undefined, page: number) =>
    api<Page<CrmContact>>(`${base(orgId)}/contacts${query({ q, tag_id: tagId, page, page_size: 25 })}`),
  contact: (orgId: string, id: string) => api<ContactDetail>(`${base(orgId)}/contacts/${id}`),
  createContact: (orgId: string, data: ContactInput) => api<CrmContact>(`${base(orgId)}/contacts`, { method: "POST", body: data }),
  updateContact: (orgId: string, id: string, data: Partial<ContactInput>) =>
    api<CrmContact>(`${base(orgId)}/contacts/${id}`, { method: "PATCH", body: data }),
  deleteContact: (orgId: string, id: string) => api<void>(`${base(orgId)}/contacts/${id}`, { method: "DELETE" }),
  setConsent: (orgId: string, id: string, opted_out: boolean) =>
    api<CrmContact>(`${base(orgId)}/contacts/${id}/consent`, { method: "POST", body: { opted_out } }),
  activities: (orgId: string, id: string) => api<Activity[]>(`${base(orgId)}/contacts/${id}/activities`),
  addActivityNote: (orgId: string, id: string, body: string) =>
    api<Activity[]>(`${base(orgId)}/contacts/${id}/activities`, { method: "POST", body: { body } }),

  customFields: (orgId: string, entity?: "contact" | "lead", includeArchived = false) =>
    api<CustomField[]>(`${base(orgId)}/custom-fields${query({ entity, include_archived: includeArchived ? "true" : undefined })}`),
  createCustomField: (
    orgId: string,
    data: { entity: "contact" | "lead"; key: string; label: string; field_type: CustomFieldType; options: string[]; required: boolean },
  ) => api<CustomField>(`${base(orgId)}/custom-fields`, { method: "POST", body: data }),
  updateCustomField: (orgId: string, id: string, data: Partial<Pick<CustomField, "label" | "options" | "required" | "archived">>) =>
    api<CustomField>(`${base(orgId)}/custom-fields/${id}`, { method: "PATCH", body: data }),

  leads: (orgId: string, params: { owner?: "me" | "unassigned"; q?: string; contact_id?: string } = {}) =>
    api<{ items: Lead[]; stages: StageSummary[] }>(`${base(orgId)}/leads${query(params)}`),
  createLead: (orgId: string, data: LeadInput) => api<Lead>(`${base(orgId)}/leads`, { method: "POST", body: data }),
  updateLead: (orgId: string, id: string, data: LeadInput) => api<Lead>(`${base(orgId)}/leads/${id}`, { method: "PATCH", body: data }),
  deleteLead: (orgId: string, id: string) => api<void>(`${base(orgId)}/leads/${id}`, { method: "DELETE" }),

  tasks: (orgId: string, f: TaskFilters) =>
    api<Task[]>(`${base(orgId)}/tasks${query({ ...f, tz_offset: -new Date().getTimezoneOffset() })}`),
  createTask: (orgId: string, data: TaskInput) => api<Task>(`${base(orgId)}/tasks`, { method: "POST", body: data }),
  updateTask: (orgId: string, id: string, data: TaskInput) => api<Task>(`${base(orgId)}/tasks/${id}`, { method: "PATCH", body: data }),
  deleteTask: (orgId: string, id: string) => api<void>(`${base(orgId)}/tasks/${id}`, { method: "DELETE" }),
};
