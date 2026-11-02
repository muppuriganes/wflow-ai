import type { AuditLog, MessageResponse, OrganizationRequest, Page, Session, TokenResponse, User } from "@/types/api";
import { api } from "./api";

export const authApi = {
  register: (data: {
    email: string;
    password: string;
    full_name: string;
    organization_name?: string;
    organization_request?: OrganizationRequest;
  }) =>
    api<TokenResponse>("/auth/register", { method: "POST", body: data, auth: false }),
  login: (data: { email: string; password: string }) =>
    api<TokenResponse>("/auth/login", { method: "POST", body: data, auth: false }),
  logout: () => api<void>("/auth/logout", { method: "POST", auth: false }),
  forgotPassword: (email: string) =>
    api<MessageResponse>("/auth/forgot-password", { method: "POST", body: { email }, auth: false }),
  resetPassword: (token: string, password: string) =>
    api<MessageResponse>("/auth/reset-password", { method: "POST", body: { token, password }, auth: false }),
  verifyEmail: (token: string) => api<User>("/auth/verify-email", { method: "POST", body: { token }, auth: false }),
  resendVerification: () => api<MessageResponse>("/auth/resend-verification", { method: "POST" }),
  changePassword: (current_password: string, new_password: string) =>
    api<MessageResponse>("/auth/change-password", { method: "POST", body: { current_password, new_password } }),
  sessions: () => api<Session[]>("/auth/sessions"),
  revokeSession: (id: string) => api<void>(`/auth/sessions/${id}`, { method: "DELETE" }),
  me: () => api<User>("/me"),
  updateMe: (full_name: string) => api<User>("/me", { method: "PATCH", body: { full_name } }),
  activity: (page = 1) => api<Page<AuditLog>>(`/me/activity?page=${page}&page_size=20`),
};
