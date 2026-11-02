import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { adminApi, platformApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import type { AdminOrgDetailOut } from "@/types/api";
import { formatDate, formatDateTime, formatRelative, timezones } from "@/utils/format";
import { orgState } from "./AdminOrganizationsPage";
import { BillingChoice } from "./AdminRequestsPage";

const ORG_KEY = "wflow.activeOrganization";

export function AdminOrganizationPage() {
  const { orgId } = useParams();
  const detail = useQuery({ queryKey: ["admin", "organization", orgId], queryFn: () => adminApi.getOrganization(orgId!) });

  if (detail.isLoading) return <LoadingRows rows={6} />;
  if (detail.error || !detail.data) return <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />;
  const org = detail.data;
  const st = orgState(org);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/admin/organizations" aria-label="Back to organizations">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-64 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{org.name}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
            <Badge tone={org.billing_required ? "primary" : "neutral"}>Billing {org.billing_required ? "on" : "off"}</Badge>
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {org.plan?.name ?? "No plan"} · {org.timezone} · joined {formatDate(org.created_at)}
          </p>
        </div>
        <StatusActions org={org} />
      </div>
      {org.status === "suspended" && org.suspended_reason && (
        <p className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger">Suspended: {org.suspended_reason}</p>
      )}
      <Tabs defaultValue="overview">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="numbers">WhatsApp numbers</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
          <TabsTrigger value="support">Support access</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview org={org} />
        </TabsContent>
        <TabsContent value="numbers">
          <Numbers orgId={org.id} />
        </TabsContent>
        <TabsContent value="members">
          <Members orgId={org.id} />
        </TabsContent>
        <TabsContent value="billing">
          <BillingTab org={org} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab org={org} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab org={org} />
        </TabsContent>
        <TabsContent value="support">
          <SupportTab org={org} />
        </TabsContent>
      </Tabs>
    </>
  );
}

function StatusActions({ org }: { org: AdminOrgDetailOut }) {
  const queryClient = useQueryClient();
  const [suspending, setSuspending] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [reason, setReason] = useState("");
  const done = (msg: string) => {
    toast.success(msg);
    void queryClient.invalidateQueries({ queryKey: ["admin"] });
  };
  const suspend = useMutation({
    mutationFn: () => adminApi.suspendOrganization(org.id, { reason: reason.trim() }),
    onSuccess: () => {
      setSuspending(false);
      done(`${org.name} suspended`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const restore = useMutation({
    mutationFn: () => adminApi.restoreOrganization(org.id),
    onSuccess: () => {
      setRestoring(false);
      done(`${org.name} restored`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  if (org.approval_status !== "approved") {
    return (
      <Button variant="secondary" asChild>
        <Link to="/admin/requests">Review request</Link>
      </Button>
    );
  }
  return (
    <>
      {org.status === "suspended" ? (
        <Button variant="secondary" onClick={() => setRestoring(true)}>
          <Play /> Restore
        </Button>
      ) : (
        <Button variant="danger-outline" onClick={() => setSuspending(true)}>
          <Pause /> Suspend
        </Button>
      )}
      <Dialog
        open={suspending}
        onOpenChange={setSuspending}
        title={`Suspend ${org.name}?`}
        description="Members can still sign in but see a suspended notice. Automations, sending and webhooks stop."
        footer={
          <>
            <Button variant="secondary" onClick={() => setSuspending(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={suspend.isPending} disabled={reason.trim().length < 3} onClick={() => suspend.mutate()}>
              Suspend
            </Button>
          </>
        }
      >
        <Field label="Reason (shown to the organization)">
          <Input value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={restoring}
        onOpenChange={setRestoring}
        title={`Restore ${org.name}?`}
        description="Automations, sending and webhooks resume."
        confirmLabel="Restore"
        loading={restore.isPending}
        onConfirm={() => restore.mutate()}
      />
    </>
  );
}

function Overview({ org }: { org: AdminOrgDetailOut }) {
  const a = org.activity_30d;
  const items: [string, string | number][] = [
    ["Team members", org.members_count],
    ["WhatsApp numbers", org.channels_count],
    ["Workflows", org.workflows_count],
    ["Contacts", a.contacts ?? 0],
    ["Conversations", a.conversations ?? 0],
    ["Messages in (30 days)", a.messages_in ?? 0],
    ["Messages out (30 days)", a.messages_out ?? 0],
    ["Workflow runs (30 days)", `${a.workflow_runs ?? 0}${a.workflow_runs_failed ? ` · ${a.workflow_runs_failed} failed` : ""}`],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Usage" description={a.last_activity_at ? `Last message ${formatRelative(a.last_activity_at)}` : "No messages yet"} />
        <CardBody>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {items.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] text-muted">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11px] text-muted">
            This month: {org.current_usage.workflow_runs ?? 0} metered runs, {org.current_usage.outbound_messages ?? 0} metered messages.
          </p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sign-up request" description={org.reviewed_at ? `Reviewed ${formatDateTime(org.reviewed_at)}` : undefined} />
        <CardBody>
          {Object.keys(org.request_details).length ? (
            <dl className="space-y-1.5 text-[13px]">
              {Object.entries(org.request_details).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[11px] capitalize text-muted">{k.replace(/_/g, " ")}</dt>
                  <dd className="break-words">{String(v)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-muted">Created before sign-up requests, or without details.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function Numbers({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["admin", "organization", orgId, "channels"], queryFn: () => platformApi.channels(orgId) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <Card>
      {!q.data?.length ? (
        <EmptyState icon={ExternalLink} title="No WhatsApp numbers" description="This organization hasn't connected a number yet." />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Number</TH>
              <TH>Status</TH>
              <TH className="hidden md:table-cell">Type</TH>
              <TH className="hidden md:table-cell">Added</TH>
            </TR>
          </THead>
          <TBody>
            {q.data.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.display_name}</TD>
                <TD className="tabular-nums">{c.phone_number ?? "—"}</TD>
                <TD>
                  <StatusDot tone={c.status === "CONNECTED" ? "success" : c.status.includes("QR") ? "warning" : "neutral"} label={c.status.replace(/_/g, " ").toLowerCase()} />
                </TD>
                <TD className="hidden text-muted md:table-cell">{c.channel_type === "simulator" ? "Simulator" : "WhatsApp Web"}</TD>
                <TD className="hidden text-muted md:table-cell">{formatDate(c.created_at)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </Card>
  );
}

function Members({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["admin", "organization", orgId, "members"], queryFn: () => platformApi.members(orgId) });
  if (q.isLoading) return <LoadingRows rows={3} />;
  if (q.error) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <Card>
      <Table>
        <THead>
          <TR>
            <TH>Person</TH>
            <TH>Role</TH>
            <TH className="hidden md:table-cell">Last sign-in</TH>
            <TH>Account</TH>
          </TR>
        </THead>
        <TBody>
          {(q.data ?? []).map((m) => (
            <TR key={m.id}>
              <TD>
                <Link to={`/admin/users/${m.user_id}`} className="font-medium hover:underline">
                  {m.full_name}
                </Link>
                <p className="text-[11px] text-muted">{m.email}</p>
              </TD>
              <TD>{m.role}</TD>
              <TD className="hidden text-muted md:table-cell">{m.last_login_at ? formatRelative(m.last_login_at) : "Never"}</TD>
              <TD>
                <StatusDot tone={m.user_active ? "success" : "danger"} label={m.user_active ? "Active" : "Disabled"} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

function BillingTab({ org }: { org: AdminOrgDetailOut }) {
  const queryClient = useQueryClient();
  const [billingOn, setBillingOn] = useState(org.billing_required);
  const [planKey, setPlanKey] = useState(org.plan?.key ?? "growth");
  const [trialDays, setTrialDays] = useState("");
  const invoices = useQuery({ queryKey: ["admin", "organization", org.id, "invoices"], queryFn: () => platformApi.invoices(org.id) });
  const save = useMutation({
    mutationFn: () =>
      platformApi.setBilling(org.id, { billing_required: billingOn, plan_key: planKey, trial_days: billingOn && trialDays ? Number(trialDays) : null }),
    onSuccess: () => {
      toast.success("Billing updated");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const sub = org.subscription;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Billing & plan"
          description={
            sub
              ? `Now: ${sub.plan_name} · ${sub.status.replace("_", " ")}${sub.trial_end && sub.status === "trialing" ? ` until ${formatDate(sub.trial_end)}` : ""}`
              : "No subscription yet"
          }
        />
        <CardBody className="space-y-4">
          <BillingChoice billingOn={billingOn} setBillingOn={setBillingOn} planKey={planKey} setPlanKey={setPlanKey} trialDays={trialDays} setTrialDays={setTrialDays} />
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save billing
          </Button>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Invoices" />
        {invoices.isLoading ? (
          <LoadingRows rows={2} />
        ) : !invoices.data?.length ? (
          <p className="px-4 py-6 text-xs text-muted">No invoices yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Amount</TH>
                <TH>Status</TH>
                <TH>Date</TH>
              </TR>
            </THead>
            <TBody>
              {invoices.data.map((i) => (
                <TR key={i.id}>
                  <TD className="text-xs">{i.invoice_number}</TD>
                  <TD className="tabular-nums">
                    {(i.amount_cents / 100).toLocaleString(undefined, { style: "currency", currency: i.currency.toUpperCase() })}
                  </TD>
                  <TD>
                    <Badge tone={i.status === "paid" ? "success" : "warning"}>{i.status}</Badge>
                  </TD>
                  <TD className="text-muted">{formatDate(i.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function SettingsTab({ org }: { org: AdminOrgDetailOut }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  useEffect(() => {
    setName(org.name);
    setTimezone(org.timezone);
  }, [org.name, org.timezone]);
  const save = useMutation({
    mutationFn: () => platformApi.updateOrganization(org.id, { name: name.trim(), timezone }),
    onSuccess: () => {
      toast.success("Organization updated");
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card className="max-w-lg">
      <CardHeader title="Organization settings" description="Changes are recorded in the organization's activity log." />
      <CardBody className="space-y-4">
        <Field label="Name">
          <Input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Timezone" hint="Used for schedules, business hours and analytics.">
          <NativeSelect value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezones().map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button onClick={() => save.mutate()} loading={save.isPending} disabled={name.trim().length < 2}>
          Save
        </Button>
      </CardBody>
    </Card>
  );
}

function ActivityTab({ org }: { org: AdminOrgDetailOut }) {
  return (
    <Card>
      <CardHeader title="Recent activity" description="Administrative events only — no message contents." />
      {!org.recent_audit_events.length ? (
        <p className="px-4 py-6 text-xs text-muted">No activity recorded.</p>
      ) : (
        <ul className="divide-y">
          {org.recent_audit_events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
              <code className="rounded-sm bg-surface-muted px-1.5 py-0.5 text-[11px]">{e.action}</code>
              <span className="text-xs text-muted">{e.target_type}</span>
              <span className="ml-auto text-xs text-muted" title={formatDateTime(e.created_at)}>
                {formatRelative(e.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function SupportTab({ org }: { org: AdminOrgDetailOut }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const active = !!org.support_access_until && new Date(org.support_access_until) > new Date();
  const open = () => {
    try {
      localStorage.setItem(ORG_KEY, org.id);
    } catch {
      // Storage unavailable: the workspace still opens, defaulting to the first organization.
    }
    void queryClient.invalidateQueries({ queryKey: ["organizations"] });
    navigate("/");
  };
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Support access" description="Message contents and customer data stay private unless the organization's owner allows support access." />
      <CardBody className="space-y-3 text-[13px]">
        {active ? (
          <>
            <p>
              The owner allowed support access until <strong>{formatDateTime(org.support_access_until!)}</strong>. You can open the workspace
              read-only. Every visit is logged and visible to the owner.
            </p>
            <Button onClick={open}>
              <ExternalLink /> Open workspace (read-only)
            </Button>
          </>
        ) : (
          <p className="text-muted">
            Support access is off. Ask the owner to turn it on under <em>Security → Support access</em> in their workspace if you need to look
            at their data.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
