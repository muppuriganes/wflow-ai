import type {
  AdminChannel,
  AdminHealth,
  AdminMember,
  AdminOrgDetailOut,
  AdminOrgListOut,
  AdminUser,
  AdminUserDetail,
  Invoice,
  OrgRequestItem,
  Page,
  Plan,
  PlatformStats,
} from "@/types/api";
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


export const platformApi = {
  plans: () => api<Plan[]>(`${base}/plans`),
  stats: (days = 30) => api<PlatformStats>(`${base}/stats?days=${days}`),
  requests: (status: "pending" | "rejected" | "approved" = "pending") =>
    api<OrgRequestItem[]>(`${base}/requests?status=${status}`),
  approve: (orgId: string, data: { billing_required: boolean; plan_key: string; trial_days?: number | null }) =>
    api<{ id: string }>(`${base}/organizations/${orgId}/approve`, { method: "POST", body: data }),
  reject: (orgId: string, reason: string) =>
    api<{ id: string }>(`${base}/organizations/${orgId}/reject`, { method: "POST", body: { reason } }),
  setBilling: (orgId: string, data: { billing_required: boolean; plan_key?: string | null; trial_days?: number | null }) =>
    api<{ id: string }>(`${base}/organizations/${orgId}/billing`, { method: "POST", body: data }),
  updateOrganization: (orgId: string, data: { name?: string; timezone?: string }) =>
    api<{ id: string }>(`${base}/organizations/${orgId}`, { method: "PATCH", body: data }),
  channels: (orgId: string) => api<AdminChannel[]>(`${base}/organizations/${orgId}/channels`),
  members: (orgId: string) => api<AdminMember[]>(`${base}/organizations/${orgId}/members`),
  invoices: (orgId: string) => api<Invoice[]>(`${base}/organizations/${orgId}/invoices`),
  users: (q: string, page: number) =>
    api<Page<AdminUser>>(`${base}/users?page=${page}&page_size=25${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  user: (userId: string) => api<AdminUserDetail>(`${base}/users/${userId}`),
  setUserActive: (userId: string, value: boolean) =>
    api<AdminUserDetail>(`${base}/users/${userId}/active`, { method: "POST", body: { value } }),
  signOutUser: (userId: string) => api<{ sessions_revoked: number }>(`${base}/users/${userId}/sign-out`, { method: "POST" }),
  sendPasswordReset: (userId: string) => api<{ sent: boolean }>(`${base}/users/${userId}/password-reset`, { method: "POST" }),
  setSuperadmin: (userId: string, value: boolean) =>
    api<AdminUserDetail>(`${base}/users/${userId}/superadmin`, { method: "POST", body: { value } }),
};
