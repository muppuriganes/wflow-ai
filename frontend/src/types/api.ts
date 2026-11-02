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

export type OrgAccessBlock = "pending" | "rejected" | "billing_required";

export type MyOrganization = Organization & {
  role: RoleSummary;
  permissions: string[];
  status: string;
  approval_status: "pending" | "approved" | "rejected";
  rejection_reason: string | null;
  billing_required: boolean;
  /** Why the workspace is closed, if it is. */
  access_block: OrgAccessBlock | null;
  /** A Super Admin viewing the workspace read-only with the owner's permission. */
  support_session: boolean;
  support_access_until: string | null;
};

export type OrganizationRequest = {
  business_type?: string;
  phone?: string;
  website?: string;
  team_size?: "1" | "2-5" | "6-20" | "21-100" | "100+";
  country?: string;
  use_case?: string;
};

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

// --- Inbox (M3) -------------------------------------------------------------------------

export type ConversationStatus = "OPEN" | "PENDING" | "ASSIGNED" | "RESOLVED" | "ARCHIVED";
export type Priority = "low" | "normal" | "high" | "urgent";
export type TagColor = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

export type Tag = { id: string; name: string; color: TagColor };
export type UserRef = { id: string; full_name: string };

export type InboxConversation = {
  id: string;
  connection_id: string;
  connection_name: string;
  connection_status: ConnectionStatus;
  contact: {
    id: string;
    display_name: string | null;
    phone_number: string | null;
    email: string | null;
    consent_status: string;
    opted_out_at: string | null;
    tags: Tag[];
  };
  is_group: boolean;
  status: ConversationStatus;
  priority: Priority;
  assignee: UserRef | null;
  automation_paused: boolean;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  resolved_at: string | null;
  created_at: string;
};

export type InboxCounts = { mine: number; unassigned: number; open: number; resolved: number };
export type Attachment = { id: string; file_name: string; content_type: string; size_bytes: number };

export type InboxMessage = {
  id: string;
  conversation_id: string;
  direction: "inbound" | "outbound";
  message_type: string;
  content: string | null;
  status: string;
  error: string | null;
  sent_by: UserRef | null;
  attachments: Attachment[];
  created_at: string;
  status_updated_at: string | null;
};

export type Note = { id: string; body: string; author: UserRef | null; created_at: string };
export type Assignee = { id: string; full_name: string; email: string; role_name: string };

// --- CRM (M3) ---------------------------------------------------------------------------

export type LeadStage = "NEW" | "QUALIFIED" | "CONTACTED" | "PROPOSAL" | "NEGOTIATION" | "CONVERTED" | "LOST";
export type CustomFieldType = "text" | "number" | "date" | "select" | "boolean";

export type CustomField = {
  id: string;
  entity: "contact" | "lead";
  key: string;
  label: string;
  field_type: CustomFieldType;
  options: string[];
  required: boolean;
  archived: boolean;
};

export type CrmContact = {
  id: string;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
  company: string | null;
  channel_type: string;
  consent_status: string;
  opted_out_at: string | null;
  last_inbound_at: string | null;
  custom_fields: Record<string, unknown>;
  tags: Tag[];
  open_leads: number;
  created_at: string;
};

export type Lead = {
  id: string;
  title: string;
  stage: LeadStage;
  position: number;
  value_amount: string | null;
  currency: string;
  source: string | null;
  score: number;
  owner: UserRef | null;
  contact: { id: string; display_name: string | null; phone_number: string | null };
  expected_close_date: string | null;
  lost_reason: string | null;
  closed_at: string | null;
  custom_fields: Record<string, unknown>;
  open_tasks: number;
  created_at: string;
  updated_at: string;
};

export type StageSummary = { stage: LeadStage; count: number; total_value: string };

export type Task = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  assignee: UserRef | null;
  contact: { id: string; label: string } | null;
  lead: { id: string; label: string } | null;
  conversation_id: string | null;
  completed_at: string | null;
  created_by: UserRef | null;
  created_at: string;
};

export type Activity = {
  id: string;
  activity_type: string;
  summary: string;
  actor: UserRef | null;
  lead_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export type ContactDetail = CrmContact & {
  conversations: { id: string; connection_name: string; status: string; last_message_at: string | null; last_message_preview: string | null }[];
  leads: Lead[];
  tasks: Task[];
};

// --- Workflows (M4) ---------------------------------------------------------------------

export type WorkflowStatus = "draft" | "active" | "paused" | "archived";
export type NodeCategory = "trigger" | "condition" | "action" | "data" | "logic" | "human";
export type NodeFieldType = "text" | "textarea" | "number" | "select" | "multiselect" | "keywords" | "tag" | "user" | "connection" | "time" | "credential";

export type NodeField = {
  key: string;
  label: string;
  type: NodeFieldType;
  required: boolean;
  help: string;
  options: { value: string; label: string }[];
  default: unknown;
  min: number | null;
  max: number | null;
  max_length: number;
  templated: boolean;
};

export type NodeType = {
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  outputs: { handle: string; label: string }[];
  needs_conversation: boolean;
  needs_contact: boolean;
  side_effects: boolean;
  fields: NodeField[];
};

export type FlowNode = { id: string; type: "wflow"; position: { x: number; y: number }; data: { nodeType: string; config: Record<string, unknown> } };
export type FlowEdge = { id: string; source: string; target: string; sourceHandle: string };
export type WorkflowDefinition = { nodes: FlowNode[]; edges: FlowEdge[]; viewport?: { x: number; y: number; zoom: number } | null };

export type WorkflowSummary = {
  id: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  trigger_type: string | null;
  published_version: number | null;
  has_unpublished_changes: boolean;
  stats: { total_7d: number; failed_7d: number; last_status: RunStatus | null; last_run_at: string | null };
  updated_at: string;
};

export type WorkflowDetail = WorkflowSummary & { definition: WorkflowDefinition; webhook_url: string | null };

export type Issue = { message: string; node_id: string | null };
export type Validation = { ok: boolean; errors: Issue[]; warnings: Issue[] };

export type WorkflowVersion = { id: string; version: number; published_by: string | null; created_at: string; is_current: boolean };

export type RunStatus = "QUEUED" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";

export type RunSummary = {
  id: string;
  workflow_id: string;
  workflow_name: string;
  version: number | null;
  status: RunStatus;
  is_test: boolean;
  trigger_type: string;
  conversation_id: string | null;
  contact_name: string | null;
  waiting_for: string | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  duration_ms: number | null;
  node_count: number;
  failed_nodes: number;
  retries: number;
};

export type NodeRun = {
  node_id: string;
  node_type: string;
  status: "running" | "waiting" | "completed" | "skipped" | "failed" | "cancelled";
  attempt: number;
  outcome: string | null;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type RunDetail = RunSummary & {
  trigger_payload: Record<string, unknown>;
  nodes: NodeRun[];
  definition: WorkflowDefinition | null;
  retry_of_run_id: string | null;
};

export type Approval = {
  id: string;
  run_id: string;
  workflow_name: string;
  title: string;
  details: string | null;
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  assignee: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string | null;
  created_at: string;
};

// --- M5 Schedules, Templates & Analytics -------------------------------------

export type ScheduleType = "once" | "daily" | "weekly" | "monthly" | "cron";
export type ScheduleStatus = "active" | "paused";

export type Schedule = {
  id: string;
  organization_id: string;
  workflow_id: string;
  workflow_name: string;
  name: string;
  description: string | null;
  status: ScheduleStatus;
  schedule_type: ScheduleType;
  config: Record<string, any>;
  timezone: string;
  target_tag_id: string | null;
  target_tag_name: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  total_runs: number;
  created_at: string;
  updated_at: string;
};

export type ScheduleCreateInput = {
  workflow_id: string;
  name: string;
  description?: string | null;
  schedule_type?: ScheduleType;
  config?: Record<string, any>;
  timezone?: string | null;
  target_tag_id?: string | null;
};

export type ScheduleUpdateInput = {
  name?: string;
  description?: string | null;
  schedule_type?: ScheduleType;
  config?: Record<string, any>;
  timezone?: string | null;
  target_tag_id?: string | null;
};

export type WorkflowTemplate = {
  id: string;
  organization_id: string | null;
  name: string;
  description: string | null;
  category: string;
  definition: WorkflowDefinition;
  is_system: boolean;
  created_at: string;
  updated_at: string;
};

export type TemplateCreateInput = {
  name: string;
  description?: string | null;
  category?: string;
  definition: WorkflowDefinition;
};

export type AnalyticsOverview = {
  new_conversations: number;
  open_conversations: number;
  avg_response_time_seconds: number | null;
  total_messages_in: number;
  total_messages_out: number;
  active_leads_count: number;
  total_pipeline_value: number;
  overdue_tasks_count: number;
  workflow_runs_total: number;
  workflow_success_rate: number | null;
};

export type DailyMessageVolume = {
  date: string;
  inbound: number;
  outbound: number;
};

export type ChannelConversationStat = {
  connection_id: string;
  channel_name: string;
  channel_type: string;
  count: number;
};

export type AgentPerformanceStat = {
  user_id: string | null;
  name: string;
  resolved_count: number;
  avg_response_time_seconds: number | null;
};

export type LeadStageStat = {
  stage: string;
  count: number;
  total_value: number;
};

export type TopFailingStep = {
  node_type: string;
  node_id: string;
  failure_count: number;
  last_error: string | null;
};

export type AnalyticsData = {
  from_date: string;
  to_date: string;
  range: string;
  overview: AnalyticsOverview;
  conversations: {
    new: number;
    resolved: number;
    avg_response_time_seconds: number | null;
    by_channel: ChannelConversationStat[];
    by_agent: AgentPerformanceStat[];
  };
  messages: DailyMessageVolume[];
  crm: {
    new_contacts: number;
    leads_by_stage: LeadStageStat[];
    conversion_rate: number | null;
    tasks: { total: number; completed: number; overdue: number };
  };
  workflows: {
    total_runs: number;
    completed_runs: number;
    failed_runs: number;
    success_rate: number | null;
    top_failing_steps: TopFailingStep[];
  };
};


// --- Milestone 6: Commercial Platform Types ---

export type Plan = {
  id: string;
  key: string;
  name: string;
  description: string;
  price_cents_monthly: number;
  price_cents_yearly: number;
  currency: string;
  limits: Record<string, number>;
  features: Record<string, any>;
  is_active: boolean;
};

export type Subscription = {
  id: string;
  organization_id: string;
  plan_id: string;
  plan_key: string;
  plan_name: string;
  status: string;
  billing_interval: 'monthly' | 'yearly';
  current_period_start: string;
  current_period_end: string;
  trial_end: string | null;
  cancel_at_period_end: boolean;
  provider: string;
};

export type UsageMeterItem = {
  metric: string;
  label: string;
  used: number;
  limit: number;
  percentage: number;
};

export type PlanUsageOverview = {
  plan: Plan;
  subscription: Subscription;
  trial_days_remaining: number | null;
  meters: UsageMeterItem[];
};

export type Invoice = {
  id: string;
  organization_id: string;
  invoice_number: string;
  amount_cents: number;
  currency: string;
  status: string;
  period_start: string;
  period_end: string;
  pdf_url: string | null;
  created_at: string;
};

export type WebhookEndpoint = {
  id: string;
  organization_id: string;
  name: string;
  target_url: string;
  events: string[];
  is_active: boolean;
  consecutive_failures: number;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type WebhookCreateOut = WebhookEndpoint & {
  secret_key: string;
};

export type WebhookDelivery = {
  id: string;
  organization_id: string;
  webhook_id: string;
  event_type: string;
  event_id: string;
  payload: Record<string, any>;
  response_status: number | null;
  response_body: string | null;
  duration_ms: number | null;
  attempt: number;
  success: boolean;
  error: string | null;
  created_at: string;
};

export type IntegrationCredential = {
  id: string;
  organization_id: string;
  name: string;
  type: string;
  masked_secret: string;
  created_at: string;
  updated_at: string;
};

export type AdminOrgListItem = {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
  plan_key: string;
  plan_name: string;
  subscription_status: string;
  trial_ends_at: string | null;
  members_count: number;
  workflows_count: number;
  channels_count: number;
  approval_status: string;
  billing_required: boolean;
  messages_30d: number;
  last_activity_at: string | null;
};

export type AdminOrgListOut = {
  items: AdminOrgListItem[];
  total: number;
  page: number;
  page_size: number;
};

export type AdminOrgDetailOut = {
  id: string;
  name: string;
  slug: string;
  status: string;
  suspended_at: string | null;
  suspended_reason: string | null;
  created_at: string;
  subscription: Subscription | null;
  plan: Plan | null;
  current_usage: Record<string, number>;
  members_count: number;
  workflows_count: number;
  channels_count: number;
  recent_audit_events: Array<{
    id: string;
    action: string;
    created_at: string;
    actor_email?: string;
    target_type?: string | null;
    details?: Record<string, unknown>;
  }>;
  timezone: string;
  approval_status: string;
  request_details: OrganizationRequest;
  rejection_reason: string | null;
  reviewed_at: string | null;
  billing_required: boolean;
  support_access_until: string | null;
  activity_30d: Partial<Record<"contacts" | "conversations" | "messages_in" | "messages_out" | "workflow_runs" | "workflow_runs_failed", number>> & {
    last_activity_at?: string | null;
  };
};

export type PlatformStats = {
  days: number;
  organizations_total: number;
  organizations_pending: number;
  organizations_suspended: number;
  organizations_new: number;
  organizations_active: number;
  users_total: number;
  users_new: number;
  channels_connected: number;
  messages_in: number;
  messages_out: number;
  workflow_runs: number;
  workflow_runs_failed: number;
  revenue_cents: number;
  billing_on: number;
  billing_off: number;
  plans: { key: string; name: string; organizations: number }[];
  daily: { day: string; messages: number; signups: number }[];
};

export type OrgRequestItem = {
  id: string;
  name: string;
  created_at: string;
  approval_status: string;
  request_details: OrganizationRequest;
  rejection_reason: string | null;
  reviewed_at: string | null;
  requester: { id: string; full_name: string; email: string; email_verified: boolean } | null;
};

export type AdminChannel = {
  id: string;
  display_name: string;
  channel_type: string;
  phone_number: string | null;
  account_name: string | null;
  status: string;
  status_detail: string | null;
  created_at: string;
};

export type AdminMember = {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  status: string;
  last_login_at: string | null;
  user_active: boolean;
};

export type AdminUser = {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superadmin: boolean;
  email_verified: boolean;
  last_login_at: string | null;
  created_at: string;
  organizations: number;
};

export type AdminUserDetail = AdminUser & {
  memberships: { organization_id: string; organization_name: string; role: string; status: string }[];
  active_sessions: number;
  login_events: { action: string; at: string; ip: string | null; user_agent: string | null; reason: string | null }[];
};

export type AdminHealth = {
  status: 'healthy' | 'degraded';
  services: Record<string, {
    status: 'ok' | 'down' | 'error';
    latency_ms?: number;
    error?: string;
  }>;
};
