import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { ErrorState, LoadingRows } from "@/components/ui/states";
import { adminApi, platformApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import type { PlatformStats } from "@/types/api";
import { cn } from "@/utils/cn";

function Stat({ label, value, hint, to, tone }: { label: string; value: string | number; hint?: string; to?: string; tone?: "warning" | "danger" }) {
  const body = (
    <div className="rounded-lg border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "warning" && "text-warning", tone === "danger" && "text-danger")}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted">{hint}</p>}
    </div>
  );
  return to ? (
    <Link to={to} className="block rounded-lg hover:ring-2 hover:ring-primary/20">
      {body}
    </Link>
  ) : (
    body
  );
}

function money(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function DailyChart({ daily }: { daily: PlatformStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.messages));
  return (
    <figure>
      <div className="flex h-36 items-end gap-[2px]" aria-hidden>
        {daily.map((d) => (
          <div key={d.day} className="group relative flex-1">
            <div className="w-full rounded-t-sm bg-primary/70 group-hover:bg-primary" style={{ height: `${Math.max(2, (d.messages / max) * 136)}px` }} />
            <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-white group-hover:block">
              {d.day}: {d.messages} messages, {d.signups} signups
            </span>
          </div>
        ))}
      </div>
      <figcaption className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{daily[0]?.day}</span>
        <span>Messages per day (all organizations)</span>
        <span>{daily.at(-1)?.day}</span>
      </figcaption>
      <table className="sr-only">
        <caption>Messages and new organizations per day</caption>
        <tbody>
          {daily.map((d) => (
            <tr key={d.day}>
              <td>{d.day}</td>
              <td>{d.messages}</td>
              <td>{d.signups}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function AdminDashboardPage() {
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ["admin", "stats", days], queryFn: () => platformApi.stats(days) });
  const health = useQuery({ queryKey: ["admin", "health"], queryFn: adminApi.getHealth, refetchInterval: 30_000 });

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Every organization at a glance. Counts only: customer messages are never shown here."
        actions={
          <NativeSelect className="w-36" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Period">
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </NativeSelect>
        }
      />
      {stats.isLoading ? (
        <LoadingRows rows={6} />
      ) : stats.error || !stats.data ? (
        <ErrorState message={errorMessage(stats.error)} onRetry={() => void stats.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Organizations" value={stats.data.organizations_total} hint={`${stats.data.organizations_new} new in ${days} days`} to="/admin/organizations" />
            <Stat
              label="Waiting for approval"
              value={stats.data.organizations_pending}
              hint="Review requests"
              to="/admin/requests"
              tone={stats.data.organizations_pending ? "warning" : undefined}
            />
            <Stat label="Active organizations" value={stats.data.organizations_active} hint={`Sent or received messages in ${days} days`} />
            <Stat label="Suspended" value={stats.data.organizations_suspended} tone={stats.data.organizations_suspended ? "danger" : undefined} />
            <Stat label="Users" value={stats.data.users_total} hint={`${stats.data.users_new} new`} to="/admin/users" />
            <Stat label="WhatsApp numbers connected" value={stats.data.channels_connected} />
            <Stat label="Messages" value={(stats.data.messages_in + stats.data.messages_out).toLocaleString()} hint={`${stats.data.messages_in.toLocaleString()} in · ${stats.data.messages_out.toLocaleString()} out`} />
            <Stat
              label="Workflow runs"
              value={stats.data.workflow_runs.toLocaleString()}
              hint={stats.data.workflow_runs ? `${Math.round((stats.data.workflow_runs_failed / stats.data.workflow_runs) * 100)}% failed` : "None yet"}
              tone={stats.data.workflow_runs && stats.data.workflow_runs_failed / stats.data.workflow_runs > 0.1 ? "danger" : undefined}
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Activity" description={`Last ${days} days`} />
              <CardBody>
                <DailyChart daily={stats.data.daily} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Plans & billing" description={`Paid invoices in ${days} days: ${money(stats.data.revenue_cents)}`} />
              <CardBody className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-muted">Billing on</span>
                  <span className="font-medium">{stats.data.billing_on}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted">Billing off (managed)</span>
                  <span className="font-medium">{stats.data.billing_off}</span>
                </div>
                <div className="border-t pt-3">
                  {stats.data.plans.map((p) => (
                    <div key={p.key} className="flex justify-between py-0.5">
                      <span>{p.name}</span>
                      <span className="tabular-nums text-muted">{p.organizations}</span>
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      )}
      <Card className="mt-4">
        <CardHeader title="System health" description="Live checks, refreshed every 30 seconds" />
        <CardBody>
          {health.isLoading ? (
            <LoadingRows rows={1} />
          ) : health.error || !health.data ? (
            <ErrorState message={errorMessage(health.error)} onRetry={() => void health.refetch()} />
          ) : (
            <ul className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {Object.entries(health.data.services).map(([name, svc]) => {
                const ok = svc.status === "ok";
                return (
                  <li key={name} className="flex items-center gap-2 rounded-md border px-3 py-2 text-[13px]" title={svc.error}>
                    {ok ? <CheckCircle2 className="size-4 text-success" aria-hidden /> : <XCircle className="size-4 text-danger" aria-hidden />}
                    <span className="capitalize">{name.replace(/_/g, " ")}</span>
                    <span className="sr-only">{ok ? "OK" : `problem: ${svc.error ?? svc.status}`}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </>
  );
}
