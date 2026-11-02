export type User = {
  id: string;
  email: string;
  full_name: string;
  email_verified_at: string | null;
  is_superadmin: boolean;
  created_at: string;
};

export type TokenResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: User;
};

export type RoleSummary = { id: string; key: string; name: string; rank: number };

export type Organization = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  created_at: string;
};

export type MyOrganization = Organization & { role: RoleSummary; permissions: string[] };

export type Member = {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: RoleSummary;
  status: string;
  joined_at: string;
};

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type Invitation = {
  id: string;
  email: string;
  role: RoleSummary;
  status: InvitationStatus;
  expires_at: string;
  created_at: string;
};

export type InvitationPreview = {
  organization_name: string;
  email: string;
  role_name: string;
  status: InvitationStatus;
};

export type Role = {
  id: string;
  key: string;
  name: string;
  description: string;
  rank: number;
  is_system: boolean;
  permissions: string[];
};

export type Permission = { code: string; category: string; description: string };

export type AuditLog = {
  id: string;
  action: string;
  actor_user_id: string | null;
  actor_email: string | null;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
};

export type Session = {
  id: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  last_used_at: string | null;
  current: boolean;
};

export type Page<T> = { items: T[]; total: number; page: number; page_size: number };

export type MessageResponse = { message: string };

export type ConnectionStatus =
  | "NOT_CONNECTED"
  | "INITIALIZING"
  | "QR_PENDING"
  | "AUTHENTICATING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "RECONNECTING"
  | "ERROR"
  | "LOGGED_OUT";

export type ChannelType = "whatsapp_web" | "simulator";

export type Connection = {
  id: string;
  channel_type: ChannelType;
  display_name: string;
  phone_number: string | null;
  account_name: string | null;
  status: ConnectionStatus;
  status_detail: string | null;
  last_connected_at: string | null;
  last_disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ChannelCapabilities = { channel_types: ChannelType[]; max_connections: number; send_limit_per_minute: number };

export type QRCode = { status: ConnectionStatus; qr_data_url: string | null; expires_in: number | null };

export type ConnectionEvent = {
  id: string;
  event_type: string;
  summary: string | null;
  details: Record<string, unknown>;
  occurred_at: string;
};

export type ContactSummary = {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  external_id: string;
  consent_status: string;
  opted_out_at: string | null;
};

export type Conversation = {
  id: string;
  connection_id: string;
  contact: ContactSummary;
  is_group: boolean;
  status: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  status: string;
  error: string | null;
  sent_by_user_id: string | null;
  created_at: string;
  status_updated_at: string | null;
};
