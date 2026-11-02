import type {
  ChannelCapabilities,
  ChannelType,
  ChatMessage,
  Connection,
  ConnectionEvent,
  Conversation,
  Page,
  QRCode,
} from "@/types/api";
import { api } from "./api";

const base = (orgId: string) => `/organizations/${orgId}`;
const conn = (orgId: string, id: string) => `${base(orgId)}/connections/${id}`;

export const channelsApi = {
  capabilities: (orgId: string) => api<ChannelCapabilities>(`${base(orgId)}/channel-capabilities`),
  list: (orgId: string) => api<Connection[]>(`${base(orgId)}/connections`),
  get: (orgId: string, id: string) => api<Connection>(conn(orgId, id)),
  create: (orgId: string, display_name: string, channel_type: ChannelType) =>
    api<Connection>(`${base(orgId)}/connections`, { method: "POST", body: { display_name, channel_type } }),
  initialize: (orgId: string, id: string) => api<Connection>(`${conn(orgId, id)}/initialize`, { method: "POST" }),
  reconnect: (orgId: string, id: string) => api<Connection>(`${conn(orgId, id)}/reconnect`, { method: "POST" }),
  logout: (orgId: string, id: string) => api<Connection>(`${conn(orgId, id)}/logout`, { method: "POST" }),
  remove: (orgId: string, id: string) => api<void>(conn(orgId, id), { method: "DELETE" }),
  qr: (orgId: string, id: string) => api<QRCode>(`${conn(orgId, id)}/qr`),
  events: (orgId: string, id: string, page = 1) =>
    api<Page<ConnectionEvent>>(`${conn(orgId, id)}/events?page=${page}&page_size=25`),
  simulateScan: (orgId: string, id: string) => api<void>(`${conn(orgId, id)}/simulate/scan`, { method: "POST" }),
  simulateInbound: (orgId: string, id: string, body: { phone: string; name: string; text: string; with_image?: boolean }) =>
    api<void>(`${conn(orgId, id)}/simulate/inbound`, { method: "POST", body }),

  conversations: (orgId: string, connectionId?: string) =>
    api<Page<Conversation>>(
      `${base(orgId)}/conversations?view=all&page_size=50${connectionId ? `&connection_id=${connectionId}` : ""}`,
    ),
  messages: (orgId: string, conversationId: string) =>
    api<ChatMessage[]>(`${base(orgId)}/conversations/${conversationId}/messages`),
  send: (orgId: string, conversationId: string, text: string, client_message_id: string) =>
    api<ChatMessage>(`${base(orgId)}/conversations/${conversationId}/messages`, {
      method: "POST",
      body: { text, client_message_id },
    }),
};
