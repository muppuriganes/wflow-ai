import {
  Activity,
  BarChart3,
  Blocks,
  Bot,
  BookOpen,
  Building2,
  CalendarClock,
  Contact,
  CreditCard,
  Inbox,
  LayoutDashboard,
  LayoutTemplate,
  type LucideIcon,
  MessageCircle,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Users,
  Workflow,
} from "lucide-react";

export type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Other paths that belong to this section (highlight the item there too). */
  also?: string[];
  /** Set while the module is not built yet: the page shows an honest "coming" state. */
  milestone?: { id: string; summary: string };
};

export const workspaceNav: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard },
  { to: "/inbox", label: "Inbox", icon: Inbox },
  { to: "/channels", label: "Channels", icon: MessageCircle },
  { to: "/workflows", label: "Workflows", icon: Workflow },
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
  { to: "/contacts", label: "Contacts & CRM", icon: Contact, also: ["/leads", "/tasks"] },
  { to: "/schedules", label: "Schedules", icon: CalendarClock },
  { to: "/integrations", label: "Integrations", icon: Blocks },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/executions", label: "Execution Logs", icon: Activity },
  { to: "/templates", label: "Templates", icon: LayoutTemplate },
];

export const adminNav: NavItem[] = [
  { to: "/organization", label: "Organization", icon: Building2 },
  { to: "/team", label: "Team & Roles", icon: Users },
  { to: "/security", label: "Security", icon: ShieldCheck },
  { to: "/billing", label: "Plans & Billing", icon: CreditCard },
  { to: "/settings", label: "Settings", icon: Settings },
];

export const platformAdminNav: NavItem[] = [
  { to: "/admin", label: "Super Admin console", icon: ShieldAlert },
];

export const MILESTONE_LABELS: Record<string, string> = {
  M2: "Milestone 2 · Channels & messaging",
  M3: "Milestone 3 · Inbox & CRM",
  M4: "Milestone 4 · Workflow engine",
  M5: "Milestone 5 · Schedules, templates & analytics",
  M6: "Milestone 6 · Commercial platform",
  AI: "AI track · after the core platform",
};
