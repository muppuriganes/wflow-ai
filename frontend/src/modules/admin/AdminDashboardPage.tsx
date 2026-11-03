import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Inbox,
  type LucideIcon,
  MessageCircle,
  Minus,
  Phone,
  Users,
  Workflow,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { Card } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { adminApi, platformApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import type { PlatformStats } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";
import { ColumnChart, SERIES, ShareBars, Sparkline, SplitBar } from "./charts";

const PERIODS = [7, 30, 90] as const;

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

/** Change against the previous period of the same length. Icon + words, never color alone. */
function Trend({ now, prev, days }: { now: number; prev: number; days: number }) {
  if (!prev && !now) return <span className="text-xs text-subtle">No activity yet</span>;
  if (!prev)
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <ArrowUpRight className="size-3.5" aria-hidden /> New in the last {days} days
      </span>
    );
  const pct = Math.round(((now - prev) / prev) * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs", pct > 0 ? "text-success" : pct < 0 ? "text-danger" : "text-muted")}>
      <Icon className="size-3.5" aria-hidden />
      {pct > 0 ? "+" : ""}
      {pct}% <span className="text-subtle">vs previous {days} days</span>
    </span>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  sub,
  trend,
  spark,
  to,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  trend?: React.ReactNode;
  spark?: React.ReactNode;
  to?: string;
}) {
  const body = (
    <Card className="flex h-full flex-col gap-3 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <div>
        <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {spark}
      {trend && <div className="mt-auto">{trend}</div>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus-visible:outline-2">
      {body}
    </Link>
  ) : (
    body
  );
}

function MiniStat({ icon: Icon, label, value, to, tone }: { icon: LucideIcon; label: string; value: string | number; to?: string; tone?: "warning" | "danger" }) {
  const inner = (
    <div className="flex items-center gap-3 rounded-lg border bg-surface px-4 py-3 transition-colors hover:bg-surface-muted/60">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          tone === "warning" ? "bg-warning-soft text-warning" : tone === "danger" ? "bg-danger-soft text-danger" : "bg-surface-muted text-muted",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
      </div>
      {to && <ArrowRight className="ml-auto size-4 text-subtle" aria-hidden />}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function Panel({ title, description, action, children, className }: { title: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-44" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function AdminDashboardPage() {
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const stats = useQuery({ queryKey: ["admin", "stats", days], queryFn: () => platformApi.stats(days) });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Platform overview</h1>
          <p className="mt-0.5 text-[13px] text-muted">Every organization at a glance. Counts only — customer messages are never shown here.</p>
        </div>
        <div className="inline-flex rounded-lg border bg-surface p-0.5" role="group" aria-label="Period">
          {PERIODS.map((d) => (
            <button
              key={d}
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={cn(
                "h-8 rounded-md px-3 text-[13px] font-medium text-muted transition-colors",
                days === d ? "bg-foreground text-white" : "hover:text-foreground",
              )}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {stats.isLoading ? (
        <DashboardSkeleton />
      ) : stats.error || !stats.data ? (
        <Card>
          <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
        </Card>
      ) : (
        <DashboardBody s={stats.data} days={days} />
      )}
      <HealthPanel />
    </div>
  );
}

function DashboardBody({ s, days }: { s: PlatformStats; days: number }) {
  const messages = s.messages_in + s.messages_out;
  const failRate = s.workflow_runs ? Math.round((s.workflow_runs_failed / s.workflow_runs) * 100) : 0;
  const daily = s.daily;
  const completedDaily = daily.map((d) => ({ ...d, completed: d.runs - d.runs_failed }));
  return (
    <>
      {s.organizations_pending > 0 && (
        <Link
          to="/admin/requests"
          className="flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-foreground hover:bg-warning-soft/70"
        >
          <AlertTriangle className="size-4 text-warning" aria-hidden />
          <span>
            <strong>{s.organizations_pending}</strong> organization{s.organizations_pending === 1 ? " is" : "s are"} waiting for approval.
          </span>
          <span className="ml-auto inline-flex items-center gap-1 font-medium text-primary">
            Review <ArrowRight className="size-4" aria-hidden />
          </span>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          icon={Building2}
          label="Organizations"
          value={s.organizations_total}
          sub={`${s.organizations_new} joined in ${days} days`}
          spark={<Sparkline values={daily.map((d) => d.signups)} color={SERIES.violet} label="New organizations per day" />}
          trend={<Trend now={s.organizations_new} prev={s.organizations_new_prev} days={days} />}
          to="/admin/organizations"
        />
        <Kpi
          icon={MessageCircle}
          label="Messages"
          value={messages.toLocaleString()}
          sub={`${s.messages_in.toLocaleString()} received · ${s.messages_out.toLocaleString()} sent`}
          spark={<Sparkline values={daily.map((d) => d.messages)} label="Messages per day" />}
          trend={<Trend now={messages} prev={s.messages_prev} days={days} />}
        />
        <Kpi
          icon={Workflow}
          label="Workflow runs"
          value={s.workflow_runs.toLocaleString()}
          sub={s.workflow_runs ? `${failRate}% failed` : "No runs yet"}
          spark={<Sparkline values={daily.map((d) => d.runs)} color={SERIES.blue} label="Workflow runs per day" />}
          trend={<Trend now={s.workflow_runs} prev={s.workflow_runs_prev} days={days} />}
        />
        <Kpi
          icon={CreditCard}
          label="Revenue"
          value={money(s.revenue_cents)}
          sub="Paid invoices"
          trend={<Trend now={s.revenue_cents} prev={s.revenue_cents_prev} days={days} />}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <MiniStat icon={Inbox} label="Pending approval" value={s.organizations_pending} to="/admin/requests" tone={s.organizations_pending ? "warning" : undefined} />
        <MiniStat icon={Building2} label="Active organizations" value={`${s.organizations_active} / ${s.organizations_total}`} />
        <MiniStat icon={XCircle} label="Suspended" value={s.organizations_suspended} tone={s.organizations_suspended ? "danger" : undefined} />
        <MiniStat icon={Users} label={`Users · ${s.users_new} new`} value={s.users_total} to="/admin/users" />
        <MiniStat icon={Phone} label="WhatsApp numbers" value={`${s.channels_connected} / ${s.channels_total ?? s.channels_connected}`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Messages per day" description={`All organizations · last ${days} days`} className="lg:col-span-2">
          <ColumnChart
            data={daily}
            series={[
              { key: "inbound", label: "Received", color: SERIES.blue },
              { key: "outbound", label: "Sent", color: SERIES.orange },
            ]}
            height={220}
            caption={`Messages received and sent per day, last ${days} days`}
          />
        </Panel>
        <Panel title="Plans & billing" description="Approved organizations">
          <SplitBar
            parts={[
              { label: "Billing on (they pay)", value: s.billing_on, color: SERIES.blue },
              { label: "Billing off (managed)", value: s.billing_off, color: SERIES.orange },
            ]}
          />
          <div className="my-5 h-px bg-border" />
          <ShareBars items={s.plans.map((p) => ({ label: p.name, value: p.organizations }))} color={SERIES.violet} />
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Workflow runs per day" description={s.workflow_runs ? `${s.workflow_runs_failed} of ${s.workflow_runs} failed` : "No runs in this period"}>
          <ColumnChart
            data={completedDaily}
            series={[
              { key: "completed", label: "Completed", color: SERIES.blue },
              { key: "runs_failed", label: "Failed", color: SERIES.critical },
            ]}
            height={160}
            caption={`Workflow runs per day, last ${days} days`}
          />
        </Panel>
        <Panel title="New organizations per day" description={`${s.organizations_new} in the last ${days} days`}>
          <ColumnChart
            data={daily}
            series={[{ key: "signups", label: "New organizations", color: SERIES.violet }]}
            height={160}
            caption={`New organizations per day, last ${days} days`}
          />
        </Panel>
      </div>
    </>
  );
}

function HealthPanel() {
  const health = useQuery({ queryKey: ["admin", "health"], queryFn: adminApi.getHealth, refetchInterval: 30_000 });
  const services = health.data ? Object.entries(health.data.services) : [];
  const down = services.filter(([, s]) => s.status !== "ok");
  return (
    <Panel
      title="System health"
      description={health.dataUpdatedAt ? `Checked ${formatRelative(new Date(health.dataUpdatedAt).toISOString())} · refreshes every 30 seconds` : "Live checks"}
      action={
        health.data && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
              down.length ? "bg-danger-soft text-danger" : "bg-success-soft text-success",
            )}
          >
            {down.length ? <XCircle className="size-3.5" aria-hidden /> : <CheckCircle2 className="size-3.5" aria-hidden />}
            {down.length ? `${down.length} need attention` : "All systems operational"}
          </span>
        )
      }
    >
      {health.isLoading ? (
        <Skeleton className="h-16" />
      ) : health.error ? (
        <ErrorState message={errorMessage(health.error)} onRetry={() => void health.refetch()} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          {services.map(([name, svc]) => {
            const ok = svc.status === "ok";
            return (
              <li key={name} className="flex items-center gap-3 rounded-lg border px-4 py-3" title={svc.error}>
                <span className={cn("flex size-8 items-center justify-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
                  {ok ? <CheckCircle2 className="size-4" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium capitalize">{name.replace(/_/g, " ")}</p>
                  <p className={cn("text-xs", ok ? "text-muted" : "text-danger")}>{ok ? "Operational" : (svc.error ?? svc.status)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
