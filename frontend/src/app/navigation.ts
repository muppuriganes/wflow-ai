import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  BookOpen,
  Building2,
  CalendarClock,
  Contact,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  type LucideIcon,
  MessageCircle,
  Settings,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Set while the module is not built yet: the page shows an honest "coming" state. */
  milestone?: { id: string; summary: string };
};

export const workspaceNav: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  {
    to: "/inbox",
    label: "Inbox",
    icon: Inbox,
    milestone: { id: "M3", summary: "Unified, real-time inbox with assignment, notes, tags and human takeover." },
  },
  {
    to: "/channels",
    label: "Channels",
    icon: MessageCircle,
    milestone: {
      id: "M2",
      summary: "Connect WhatsApp by QR code (whatsapp-web.js), monitor connection health and logs.",
    },
  },
  {
    to: "/workflows",
    label: "Workflows",
    icon: Workflow,
    milestone: { id: "M4", summary: "Visual drag-and-drop builder with versioning, publishing and durable execution." },
  },
  {
    to: "/agents",
    label: "AI Agents",
    icon: Bot,
    milestone: { id: "AI", summary: "Specialised AI agents. Planned after the core platform is complete." },
  },
  {
    to: "/ai-studio",
    label: "AI Studio",
    icon: Sparkles,
    milestone: { id: "AI", summary: "Model management and testing. Planned after the core platform is complete." },
  },
  {
    to: "/knowledge",
    label: "Knowledge Base",
    icon: BookOpen,
    milestone: { id: "AI", summary: "Document upload and retrieval for AI answers. Planned with the AI track." },
  },
  {
    to: "/contacts",
    label: "Contacts & CRM",
    icon: Contact,
    milestone: { id: "M3", summary: "Contacts, custom fields, lead pipeline and follow-up tasks." },
  },
  {
    to: "/schedules",
    label: "Schedules",
    icon: CalendarClock,
    milestone: { id: "M5", summary: "Scheduled and recurring automations with timezone support." },
  },
  {
    to: "/integrations",
    label: "Integrations",
    icon: Blocks,
    milestone: { id: "M6", summary: "Connector registry, webhooks and REST integrations with encrypted credentials." },
  },
  {
    to: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    milestone: { id: "M5", summary: "Conversation, lead and automation analytics from real data, with export." },
  },
  {
    to: "/executions",
    label: "Execution Logs",
    icon: Activity,
    milestone: { id: "M4", summary: "Inspect every workflow run, node inputs and outputs, retry and cancel." },
  },
  {
    to: "/templates",
    label: "Templates",
    icon: LayoutTemplate,
    milestone: { id: "M5", summary: "Ready-made workflow templates you can preview, copy and customise." },
  },
];

export const adminNav: NavItem[] = [
  { to: "/organization", label: "Organization", icon: Building2 },
  { to: "/team", label: "Team & Roles", icon: Users },
  { to: "/security", label: "Security", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const MILESTONE_LABELS: Record<string, string> = {
  M2: "Milestone 2 · Channels & messaging",
  M3: "Milestone 3 · Inbox & CRM",
  M4: "Milestone 4 · Workflow engine",
  M5: "Milestone 5 · Schedules, templates & analytics",
  M6: "Milestone 6 · Commercial platform",
  AI: "AI track · after the core platform",
};
