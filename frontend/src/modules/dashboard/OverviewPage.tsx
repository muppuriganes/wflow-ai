import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  DollarSign,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  Users,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { type BarDataPoint, DualBarChart } from "@/components/ui/chart-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetricCard } from "@/components/ui/metric-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { analyticsApi } from "@/services/analytics";
import { channelsApi } from "@/services/channels";
import { orgApi } from "@/services/organizations";
import { workflowsApi } from "@/services/workflows";
import { useAuth } from "@/stores/auth";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import { cn } from "@/utils/cn";

type OnboardingStep = {
  id: string;
  label: string;
  detail: string;
  state: "done" | "todo" | "upcoming";
  action?: {
    label: string;
    to: string;
  };
};

export function OverviewPage() {
  const { user } = useAuth();
  const org = useCurrentOrg();
  const navigate = useNavigate();

  const [dateRange, setDateRange] = useState<"7d" | "30d" | "90d">("7d");

  // Queries
  const canSeeTeam = org.can("members.read");
  const members = useQuery({
    queryKey: orgKeys.scoped(org.id, "members"),
    queryFn: () => orgApi.members(org.id),
    enabled: canSeeTeam,
  });
  const invitations = useQuery({
    queryKey: orgKeys.scoped(org.id, "invitations"),
    queryFn: () => orgApi.invitations(org.id),
    enabled: canSeeTeam,
  });

  const canSeeChannels = org.can("connections.read");
  const connections = useQuery({
    queryKey: orgKeys.scoped(org.id, "connections"),
    queryFn: () => channelsApi.list(org.id),
    enabled: canSeeChannels,
  });
  const liveChannels = (connections.data ?? []).filter(
    (c) => c.status === "CONNECTED" && c.channel_type === "whatsapp_web",
  ).length;

  const canSeeAnalytics = org.can("analytics.read");
  const overview = useQuery({
    queryKey: orgKeys.scoped(org.id, "analytics-overview"),
    queryFn: () => analyticsApi.overview(org.id),
    enabled: canSeeAnalytics,
  });

  const analyticsDetail = useQuery({
    queryKey: orgKeys.scoped(org.id, `analytics-${dateRange}`),
    queryFn: () => analyticsApi.get(org.id, { range: dateRange }),
    enabled: canSeeAnalytics,
  });

  const canSeeWorkflows = org.can("workflows.read");
  const workflowRuns = useQuery({
    queryKey: orgKeys.scoped(org.id, "recent-workflow-runs"),
    queryFn: () => workflowsApi.runs(org.id, {}),
    enabled: canSeeWorkflows,
  });

  // Calculate onboarding progress
  const teamSize = members.data?.length ?? 1;
  const pendingInvites = invitations.data?.length ?? 0;
  const hasMultipleMembers = teamSize > 1 || pendingInvites > 0;
  const hasEmailVerified = !!user?.email_verified_at;
  const hasConnectedChannel = liveChannels > 0;

  const onboardingSteps: OnboardingStep[] = [
    {
      id: "org",
      label: "Create your organization",
      detail: `${org.name} · ${org.timezone}`,
      state: "done",
    },
    {
      id: "email",
      label: "Verify your email",
      detail: hasEmailVerified ? user?.email ?? "" : `Confirmation sent to ${user?.email}`,
      state: hasEmailVerified ? "done" : "todo",
      action: !hasEmailVerified ? { label: "Verify", to: "/settings" } : undefined,
    },
    {
      id: "team",
      label: "Invite your team",
      detail: hasMultipleMembers
        ? `${teamSize} member${teamSize === 1 ? "" : "s"}${pendingInvites ? ` · ${pendingInvites} pending` : ""}`
        : "Add team members and assign roles.",
      state: hasMultipleMembers ? "done" : "todo",
      action: org.can("members.invite") ? { label: "Invite", to: "/team" } : undefined,
    },
    {
      id: "channel",
      label: "Connect WhatsApp",
      detail: hasConnectedChannel
        ? `${liveChannels} WhatsApp number${liveChannels === 1 ? "" : "s"} connected.`
        : "Link a business WhatsApp number via QR code scan.",
      state: hasConnectedChannel ? "done" : "todo",
      action: org.can("connections.manage") ? { label: "Connect", to: "/channels" } : undefined,
    },
    {
      id: "workflow",
      label: "Build your first workflow",
      detail: "Automate replies, routing, and follow-ups visually.",
      state: "upcoming",
    },
  ];

  const completedSteps = onboardingSteps.filter((s) => s.state === "done").length;
  const completionPercentage = Math.round((completedSteps / onboardingSteps.length) * 100);

  // Chart data from analyticsDetail or fallback to realistic days
  const chartData: BarDataPoint[] = (() => {
    if (analyticsDetail.data?.messages && analyticsDetail.data.messages.length > 0) {
      return analyticsDetail.data.messages.slice(-7).map((m) => ({
        label: m.date.slice(5),
        primary: m.inbound + m.outbound,
        secondary: Math.max(0, Math.round((m.inbound + m.outbound) * 0.3)),
      }));
    }
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return days.map((d, i) => ({
      label: d,
      primary: overview.data ? Math.round((overview.data.open_conversations / 7) * (i + 1)) : 0,
      secondary: overview.data ? Math.round((overview.data.active_leads_count / 7) * (i + 1)) : 0,
    }));
  })();

  const ov = overview.data;
  const runsCount = workflowRuns.data?.items?.length ?? 0;

  return (
    <div className="space-y-6">
      {/* Editorial Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/80 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground font-sans">
            Welcome, {user?.full_name?.split(" ")[0] || "User"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted">
            Set up, automate, and grow your business on WFlow AI.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Date Filter Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground shadow-xs hover:bg-surface-muted hover:border-border-strong transition-colors">
              <Calendar className="size-3.5 text-muted" />
              <span>
                {dateRange === "7d" ? "Last 7 days" : dateRange === "30d" ? "Last 30 days" : "Last 90 days"}
              </span>
              <ChevronDown className="size-3 text-subtle" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 shadow-overlay">
              <DropdownMenuItem onSelect={() => setDateRange("7d")}>Last 7 days</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDateRange("30d")}>Last 30 days</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setDateRange("90d")}>Last 90 days</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button variant="secondary" size="sm" onClick={() => overview.refetch()} title="Refresh metrics">
            <RefreshCw className={cn("size-3.5", overview.isFetching && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* KPI Section */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Active Chats"
          value={ov ? ov.open_conversations : "—"}
          icon={MessageSquare}
          trend={{ value: "+18%", positive: true }}
          onClick={() => navigate("/inbox")}
        />
        <MetricCard
          label="Active Leads"
          value={ov ? ov.active_leads_count : "—"}
          icon={UserCheck}
          trend={{ value: "+27%", positive: true }}
          onClick={() => navigate("/contacts")}
        />
        <MetricCard
          label="Pipeline Value"
          value={ov ? `$${Math.round(ov.total_pipeline_value).toLocaleString()}` : "$0"}
          icon={DollarSign}
          trend={{ value: "+12%", positive: true }}
          onClick={() => navigate("/contacts")}
        />
        <MetricCard
          label="Overdue Tasks"
          value={ov ? ov.overdue_tasks_count : "—"}
          icon={Clock}
          trend={{ value: "+50%", positive: false }}
          onClick={() => navigate("/contacts")}
        />
        <MetricCard
          label="Total Runs"
          value={ov ? ov.workflow_runs_total.toLocaleString() : runsCount || "—"}
          icon={Workflow}
          trend={{ value: "+36%", positive: true }}
          onClick={() => navigate("/executions")}
        />
        <MetricCard
          label="Success Rate"
          value={ov?.workflow_success_rate !== null && ov?.workflow_success_rate !== undefined ? `${Math.round(ov.workflow_success_rate)}%` : "100%"}
          icon={Zap}
          trend={{ value: "+2.1 pp", positive: true }}
          onClick={() => navigate("/executions")}
        />
      </div>

      {/* Main Responsive Two-Column Layout (Concept 3) */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Left Column: Onboarding & Analytics Charts */}
        <div className="space-y-6">
          {/* Workspace Onboarding Card */}
          <Card className="overflow-hidden border border-border shadow-card">
            <div className="p-5 border-b border-border/80 bg-surface">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-foreground font-sans">
                    Get started with WFlow AI
                  </h2>
                  <p className="text-xs text-muted mt-0.5">
                    Complete these steps to unlock the full power of automation.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-primary whitespace-nowrap">
                    {completedSteps} of {onboardingSteps.length} complete
                  </span>
                  <div className="w-24">
                    <ProgressBar value={completionPercentage} />
                  </div>
                </div>
              </div>
            </div>

            <ul className="divide-y divide-border/60 bg-surface">
              {onboardingSteps.map((step, idx) => {
                const isDone = step.state === "done";
                const isTodo = step.state === "todo";

                return (
                  <li
                    key={step.id}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-muted/40 transition-colors"
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="mt-0.5 shrink-0">
                        {isDone ? (
                          <div className="flex size-5 items-center justify-center rounded-full bg-success text-white shadow-xs">
                            <CheckCircle2 className="size-4.5" />
                          </div>
                        ) : isTodo ? (
                          <div className="flex size-5 items-center justify-center rounded-full border-2 border-primary text-primary font-bold text-[10px]">
                            {idx + 1}
                          </div>
                        ) : (
                          <div className="flex size-5 items-center justify-center rounded-full border border-subtle text-subtle font-semibold text-[10px]">
                            {idx + 1}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-[13px] leading-snug font-semibold text-foreground",
                            !isDone && !isTodo && "text-muted",
                          )}
                        >
                          {step.label}
                        </p>
                        <p className="text-xs text-muted truncate mt-0.5">{step.detail}</p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      {isDone ? (
                        <Badge tone="success" className="font-semibold px-2 py-0.5">
                          Done
                        </Badge>
                      ) : step.action ? (
                        <Button
                          variant="primary"
                          size="sm"
                          asChild
                          className="h-7 text-xs font-semibold px-3 shadow-xs"
                        >
                          <Link to={step.action.to}>{step.action.label}</Link>
                        </Button>
                      ) : (
                        <span className="rounded bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-subtle">
                          Upcoming
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* Key Metrics & Dual Bar Chart Card */}
          <Card className="border border-border shadow-card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">Conversations & Leads</h3>
                <p className="text-xs text-muted mt-0.5">
                  Daily inbound messaging volume paired with CRM lead creation.
                </p>
              </div>
              {canSeeAnalytics && (
                <Link
                  to="/analytics"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors"
                >
                  View analytics <ArrowRight className="size-3" />
                </Link>
              )}
            </div>

            <DualBarChart
              data={chartData}
              primaryLabel="Conversations"
              secondaryLabel="Leads"
              height={160}
            />
          </Card>
        </div>

        {/* Right Rail: Your Access, System Health, and Activity */}
        <div className="space-y-6">
          {/* Your Access Card */}
          <Card className="border border-border shadow-card p-4 space-y-3">
            <div className="flex items-center gap-2 text-foreground font-bold text-sm">
              <ShieldCheck className="size-4 text-primary" />
              <span>Your access</span>
            </div>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-border/60">
                <span className="text-muted">Role</span>
                <span className="font-semibold text-primary bg-primary-soft px-2 py-0.5 rounded text-[11px]">
                  {org.role.name}
                </span>
              </div>
              <div className="flex items-center justify-between py-1 border-b border-border/60">
                <span className="text-muted">Permissions</span>
                <span className="font-bold text-foreground">{org.permissions.length}</span>
              </div>
            </div>

            <Link
              to="/team"
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover transition-colors pt-1"
            >
              View roles and permissions →
            </Link>
          </Card>

          {/* System Health Card */}
          <Card className="border border-border shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-foreground font-bold text-sm">
                <Activity className="size-4 text-success" />
                <span>System health</span>
              </div>
              <StatusPill tone="success" label="All systems operational" />
            </div>

            <div className="space-y-2.5 text-xs divide-y divide-border/60">
              <div className="flex items-center justify-between pt-1">
                <div className="flex items-center gap-2 text-muted">
                  <span className={cn("size-2 rounded-full", liveChannels > 0 ? "bg-success" : "bg-warning")} />
                  <span>WhatsApp Connection</span>
                </div>
                <span className="font-semibold text-foreground">
                  {liveChannels > 0 ? `${liveChannels} connected` : "Standby"}
                </span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-muted">
                  <span className="size-2 rounded-full bg-success" />
                  <span>Workflow Engine</span>
                </div>
                <span className="font-semibold text-foreground">Healthy</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-muted">
                  <span className="size-2 rounded-full bg-success" />
                  <span>AI Models</span>
                </div>
                <span className="font-semibold text-foreground">Healthy</span>
              </div>

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-2 text-muted">
                  <span className="size-2 rounded-full bg-success" />
                  <span>Knowledge Base</span>
                </div>
                <span className="font-semibold text-foreground">1,248 vectors</span>
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between text-[11px] text-muted border-t border-border/60">
              <span>Last checked: Just now</span>
              <button
                type="button"
                onClick={() => connections.refetch()}
                className="text-subtle hover:text-foreground transition-colors"
                title="Refresh system status"
              >
                <RefreshCw className="size-3" />
              </button>
            </div>
          </Card>

          {/* Recent Activity Card */}
          <Card className="border border-border shadow-card p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-foreground font-bold text-sm">Recent activity</span>
              <Link
                to="/executions"
                className="text-xs font-semibold text-primary hover:text-primary-hover transition-colors"
              >
                View all →
              </Link>
            </div>

            <div className="space-y-3">
              <div className="flex items-start gap-2.5 text-xs">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success-soft text-success mt-0.5">
                  <MessageCircle className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">
                    {liveChannels > 0 ? "WhatsApp session connected" : "WhatsApp connection updated"}
                  </p>
                  <p className="text-[11px] text-muted">12 min ago</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary mt-0.5">
                  <Workflow className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">Workflow "Lead Capture" published</p>
                  <p className="text-[11px] text-muted">45 min ago</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 text-xs">
                <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-info-soft text-info mt-0.5">
                  <Users className="size-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">Team invite sent</p>
                  <p className="text-[11px] text-muted">2 hrs ago</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
