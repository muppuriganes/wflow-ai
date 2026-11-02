import type { Invoice, Subscription } from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}/billing`;

export const billingApi = {
  createCheckout: (orgId: string, data: { plan_key: string; return_url: string }) =>
    api<{ checkout_url: string }>(`${base(orgId)}/checkout`, { method: "POST", body: data }),
  createPortal: (orgId: string, data: { return_url: string }) =>
    api<{ portal_url: string }>(`${base(orgId)}/portal`, { method: "POST", body: data }),
  listInvoices: (orgId: string) => api<Invoice[]>(`${base(orgId)}/invoices`),
  cancelSubscription: (orgId: string) =>
    api<Subscription>(`${base(orgId)}/cancel`, { method: "POST" }),
  resumeSubscription: (orgId: string) =>
    api<Subscription>(`${base(orgId)}/resume`, { method: "POST" }),
};

