import type { AdminHealth, AdminOrgDetailOut, AdminOrgListOut } from "@/types/api";
import { api } from "./api";

const base = "/admin";

export const adminApi = {
  getHealth: () => api<AdminHealth>(`${base}/health`),
  listOrganizations: (params?: {
    search?: string;
    plan_key?: string;
    status?: string;
    page?: number;
    page_size?: number;
  }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.plan_key) q.set("plan_key", params.plan_key);
    if (params?.status) q.set("status", params.status);
    if (params?.page) q.set("page", String(params.page));
    if (params?.page_size) q.set("page_size", String(params.page_size));
    const qs = q.toString();
    return api<AdminOrgListOut>(`${base}/organizations${qs ? `?${qs}` : ""}`);
  },
  getOrganization: (orgId: string) => api<AdminOrgDetailOut>(`${base}/organizations/${orgId}`),
  assignPlan: (orgId: string, data: { plan_key: string; trial_days?: number }) =>
    api<AdminOrgDetailOut>(`${base}/organizations/${orgId}/plan`, { method: "POST", body: data }),
  suspendOrganization: (orgId: string, data: { reason: string }) =>
    api<AdminOrgDetailOut>(`${base}/organizations/${orgId}/suspend`, { method: "POST", body: data }),
  restoreOrganization: (orgId: string) =>
    api<AdminOrgDetailOut>(`${base}/organizations/${orgId}/restore`, { method: "POST" }),
};
