import type {
  AuditLog,
  Invitation,
  InvitationPreview,
  Member,
  MyOrganization,
  Organization,
  Page,
  Permission,
  Role,
} from "@/types/api";
import { api } from "./api";

const org = (id: string) => `/organizations/${id}`;

export const orgApi = {
  list: () => api<MyOrganization[]>("/organizations"),
  create: (data: { name: string; timezone: string }) => api<MyOrganization>("/organizations", { method: "POST", body: data }),
  update: (id: string, data: { name?: string; timezone?: string }) =>
    api<MyOrganization>(org(id), { method: "PATCH", body: data }),
  remove: (id: string) => api<void>(org(id), { method: "DELETE" }),

  members: (id: string) => api<Member[]>(`${org(id)}/members`),
  updateMember: (id: string, memberId: string, role_key: string) =>
    api<Member>(`${org(id)}/members/${memberId}`, { method: "PATCH", body: { role_key } }),
  removeMember: (id: string, memberId: string) => api<void>(`${org(id)}/members/${memberId}`, { method: "DELETE" }),

  invitations: (id: string) => api<Invitation[]>(`${org(id)}/invitations`),
  invite: (id: string, email: string, role_key: string) =>
    api<Invitation>(`${org(id)}/invitations`, { method: "POST", body: { email, role_key } }),
  revokeInvitation: (id: string, invitationId: string) =>
    api<void>(`${org(id)}/invitations/${invitationId}`, { method: "DELETE" }),
  previewInvitation: (token: string) =>
    api<InvitationPreview>("/invitations/preview", { method: "POST", body: { token }, auth: false }),
  acceptInvitation: (token: string) => api<Organization>("/invitations/accept", { method: "POST", body: { token } }),

  roles: (id: string) => api<Role[]>(`${org(id)}/roles`),
  permissions: () => api<Permission[]>("/permissions"),
  auditLogs: (id: string, page: number, action?: string) =>
    api<Page<AuditLog>>(
      `${org(id)}/audit-logs?page=${page}&page_size=25${action ? `&action=${encodeURIComponent(action)}` : ""}`,
    ),
};
