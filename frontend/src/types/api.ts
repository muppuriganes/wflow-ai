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
