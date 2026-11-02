import type {
  IntegrationCredential,
  WebhookCreateOut,
  WebhookDelivery,
  WebhookEndpoint,
} from "@/types/api";
import { api } from "./api";

const webhooksBase = (orgId: string) => `/organizations/${orgId}/webhooks`;
const credsBase = (orgId: string) => `/organizations/${orgId}/credentials`;

export const integrationsApi = {
  // Webhooks
  listWebhooks: (orgId: string) => api<WebhookEndpoint[]>(webhooksBase(orgId)),
  createWebhook: (
    orgId: string,
    data: { name: string; target_url: string; events: string[]; is_active?: boolean },
  ) => api<WebhookCreateOut>(webhooksBase(orgId), { method: "POST", body: data }),
  updateWebhook: (
    orgId: string,
    id: string,
    data: Partial<{ name: string; target_url: string; events: string[]; is_active: boolean }>,
  ) => api<WebhookEndpoint>(`${webhooksBase(orgId)}/${id}`, { method: "PATCH", body: data }),
  deleteWebhook: (orgId: string, id: string) =>
    api<void>(`${webhooksBase(orgId)}/${id}`, { method: "DELETE" }),
  pingWebhook: (orgId: string, id: string) =>
    api<{ success: boolean; status_code?: number; duration_ms?: number; error?: string }>(
      `${webhooksBase(orgId)}/${id}/ping`,
      { method: "POST" },
    ),
  listDeliveries: (orgId: string, id: string) =>
    api<WebhookDelivery[]>(`${webhooksBase(orgId)}/${id}/deliveries`),
  redeliver: (orgId: string, id: string, deliveryId: string) =>
    api<{ success: boolean; status_code?: number; error?: string }>(
      `${webhooksBase(orgId)}/${id}/deliveries/${deliveryId}/redeliver`,
      { method: "POST" },
    ),

  // Credentials
  listCredentials: (orgId: string) => api<IntegrationCredential[]>(credsBase(orgId)),
  createCredential: (
    orgId: string,
    data: { name: string; type: "api_key" | "bearer" | "basic"; secret: string },
  ) => api<IntegrationCredential>(credsBase(orgId), { method: "POST", body: data }),
  deleteCredential: (orgId: string, id: string) =>
    api<void>(`${credsBase(orgId)}/${id}`, { method: "DELETE" }),
};
