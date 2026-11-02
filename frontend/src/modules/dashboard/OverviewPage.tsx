import { useQuery } from "@tanstack/react-query";
import { ArrowRight, BarChart3, CheckCircle2, Circle, Clock3 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { analyticsApi } from "@/services/analytics";
import { channelsApi } from "@/services/channels";
import { orgApi } from "@/services/organizations";
import { useAuth } from "@/stores/auth";
import { orgKeys, useCurrentOrg } from "@/stores/organization";

type Step = { label: string; detail: ReactNode; state: "done" | "todo" | "upcoming"; action?: ReactNode };

function StepRow({ step }: { step: Step }) {
  const Icon = step.state === "done" ? CheckCircle2 : step.state === "todo" ? Circle : Clock3;
  const color = step.state === "done" ? "text-success" : step.state === "todo" ? "text-primary" : "text-subtle";
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <Icon className={`mt-0.5 size-4 shrink-0 ${color}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className={step.state === "upcoming" ? "text-muted" : "font-medium"}>{step.label}</p>
        <p className="text-xs text-muted">{step.detail}</p>
      </div>
      {step.state === "upcoming" ? <Badge>Upcoming</Badge> : step.state === "done" ? <Badge tone="success">Done</Badge> : step.action}
    </li>
  );
}

export function OverviewPage() {
  const { user } = useAuth();
  const org = useCurrentOrg();
  const canSeeTeam = org.can("members.read");
  const members = useQuery({ queryKey: orgKeys.scoped(org.id, "members"), queryFn: () => orgApi.members(org.id), enabled: canSeeTeam });
  const invitations = useQuery({ queryKey: orgKeys.scoped(org.id, "invitations"), queryFn: () => orgApi.invitations(org.id), enabled: canSeeTeam });
  const canSeeChannels = org.can("connections.read");
  const connections = useQuery({ queryKey: orgKeys.scoped(org.id, "connections"), queryFn: () => channelsApi.list(org.id), enabled: canSeeChannels });
  const liveChannels = (connections.data ?? []).filter((c) => c.status === "CONNECTED" && c.channel_type === "whatsapp_web").length;

  const canSeeAnalytics = org.can("analytics.read");
  const overview = useQuery({
    queryKey: orgKeys.scoped(org.id, "analytics-overview"),
    queryFn: () => analyticsApi.overview(org.id),
    enabled: canSeeAnalytics,
  });

  const teamSize = members.data?.length ?? 0;
  const pending = invitations.data?.length ?? 0;
  const steps: Step[] = [
    { label: "Create your organization", detail: `${org.name} · ${org.timezone}`, state: "done" },
    {
      label: "Verify your email",
      detail: user?.email_verified_at ? user.email : `We sent a link to ${user?.email}`,
      state: user?.email_verified_at ? "done" : "todo",
    },
    {
      label: "Invite your team",
      detail: canSeeTeam ? `${teamSize} member${teamSize === 1 ? "" : "s"}${pending ? ` · ${pending} pending invitation${pending === 1 ? "" : "s"}` : ""}` : "Ask an admin to invite colleagues",
      state: teamSize > 1 || pending > 0 ? "done" : "todo",
      action: org.can("members.invite") ? (
        <Link to="/team" className="text-xs font-medium text-primary hover:underline">
          Invite
        </Link>
      ) : undefined,
    },
    {
      label: "Connect WhatsApp",
      detail: liveChannels ? `${liveChannels} WhatsApp number${liveChannels === 1 ? "" : "s"} connected` : "Link a WhatsApp number by scanning a QR code.",
      state: liveChannels ? "done" : "todo",
      action: org.can("connections.manage") ? (
        <Link to="/channels" className="text-xs font-medium text-primary hover:underline">
          Connect
        </Link>
      ) : undefined,
    },
    { label: "Build your first workflow", detail: "Automate replies, routing and follow-ups visually.", state: "upcoming" },
  ];
  const done = steps.filter((s) => s.state === "done").length;

  return (
    <>
      <PageHeader title={`Welcome, ${user?.full_name.split(" ")[0] ?? ""}`} description={`Here's where ${org.name} stands.`} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader title="Get started" description={`${done} of ${steps.length} complete`} />
          <ul className="divide-y">
            {steps.map((step) => (
              <StepRow key={step.label} step={step} />
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Your access" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted">Role</span>
              <Badge tone="primary">{org.role.name}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">Permissions</span>
              <span className="font-medium">{org.permissions.length}</span>
            </div>
            <Link to="/team" className="block text-xs font-medium text-primary hover:underline">
              View roles and permissions
            </Link>
          </CardBody>
        </Card>
      </div>
      <Card className="mt-4">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Activity metrics</h2>
            <p className="text-xs text-muted">Real-time counts for conversations, leads, tasks, and workflows.</p>
          </div>
          {canSeeAnalytics && (
            <Link to="/analytics" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              View detailed analytics <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
        {overview.data ? (
          <div className="grid grid-cols-2 divide-x divide-y border-t border-border/40 sm:grid-cols-3 lg:grid-cols-6">
            <div className="p-4">
              <div className="text-xs text-muted">Active Chats</div>
              <div className="mt-1 text-xl font-bold">{overview.data.open_conversations}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-muted">Active Leads</div>
              <div className="mt-1 text-xl font-bold">{overview.data.active_leads_count}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-muted">Pipeline Value</div>
              <div className="mt-1 text-xl font-bold">
                ${Math.round(overview.data.total_pipeline_value).toLocaleString()}
              </div>
            </div>
            <div className="p-4">
              <div className="text-xs text-muted">Overdue Tasks</div>
              <div className="mt-1 text-xl font-bold">{overview.data.overdue_tasks_count}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-muted">Total Runs</div>
              <div className="mt-1 text-xl font-bold">{overview.data.workflow_runs_total}</div>
            </div>
            <div className="p-4">
              <div className="text-xs text-muted">Success Rate</div>
              <div className="mt-1 text-xl font-bold">
                {overview.data.workflow_success_rate !== null ? `${Math.round(overview.data.workflow_success_rate)}%` : "—"}
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={BarChart3}
            title="No activity yet"
            description="Metrics are calculated from real conversations and workflow runs. They appear here once a channel is connected."
          />
        )}
      </Card>
    </>
  );
}
