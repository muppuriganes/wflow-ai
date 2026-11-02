import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  Eye,
  Lock,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Search,
  Server,
  Sliders,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { adminApi } from "@/services/admin";
import { errorMessage } from "@/services/api";
import { useAuth } from "@/stores/auth";
import type { AdminOrgListItem } from "@/types/api";
import { formatDate } from "@/utils/format";

export function AdminPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Search & Pagination filters
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);

  // Modals
  const [inspectOrgId, setInspectOrgId] = useState<string | null>(null);
  const [assignPlanOrg, setAssignPlanOrg] = useState<AdminOrgListItem | null>(null);
  const [targetPlanKey, setTargetPlanKey] = useState("growth");
  const [trialDays, setTrialDays] = useState<number | undefined>(undefined);

  const [suspendOrg, setSuspendOrg] = useState<AdminOrgListItem | null>(null);
  const [suspendReason, setSuspendReason] = useState("");

  const [restoreOrgTarget, setRestoreOrgTarget] = useState<AdminOrgListItem | null>(null);

  // Queries
  const healthQuery = useQuery({
    queryKey: ["admin", "health"],
    queryFn: () => adminApi.getHealth(),
    enabled: !!user?.is_superadmin,
    refetchInterval: 30000,
  });

  const orgsQuery = useQuery({
    queryKey: ["admin", "orgs", search, planFilter, statusFilter, page],
    queryFn: () =>
      adminApi.listOrganizations({
        search: search.trim() || undefined,
        plan_key: planFilter || undefined,
        status: statusFilter || undefined,
        page,
        page_size: 15,
      }),
    enabled: !!user?.is_superadmin,
  });

  const orgDetailQuery = useQuery({
    queryKey: ["admin", "org-detail", inspectOrgId],
    queryFn: () => (inspectOrgId ? adminApi.getOrganization(inspectOrgId) : null),
    enabled: !!inspectOrgId && !!user?.is_superadmin,
  });

  // Mutations
  const assignPlanMutation = useMutation({
    mutationFn: () =>
      adminApi.assignPlan(assignPlanOrg!.id, {
        plan_key: targetPlanKey,
        trial_days: trialDays || undefined,
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "orgs"] });
      setAssignPlanOrg(null);
      toast.success(`Plan updated to ${updated.plan?.name ?? targetPlanKey} for ${updated.name}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const suspendMutation = useMutation({
    mutationFn: () =>
      adminApi.suspendOrganization(suspendOrg!.id, {
        reason: suspendReason.trim(),
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "orgs"] });
      setSuspendOrg(null);
      setSuspendReason("");
      toast.success(`Organization ${updated.name} suspended`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => adminApi.restoreOrganization(id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "orgs"] });
      setRestoreOrgTarget(null);
      toast.success(`Organization ${updated.name} restored to active status`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!user?.is_superadmin) {
    return (
      <EmptyState
        icon={Lock}
        title="Super Admin Access Required"
        description="You do not have permission to view or manage the platform administration console."
      />
    );
  }

  const health = healthQuery.data;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Platform Administration"
        description="Cross-tenant administration console, resource limit overrides, organization lifecycle, and cluster health."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void healthQuery.refetch();
              void orgsQuery.refetch();
            }}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        }
      />

      {/* System Infrastructure Health */}
      <Card>
        <CardHeader
          title={
            <div className="flex items-center gap-2">
              <Server className="size-4 text-primary" />
              <span>Infrastructure Health & Services</span>
            </div>
          }
          description="Live diagnostic probes checking core platform dependencies"
          actions={
            health && (
              <Badge tone={health.status === "healthy" ? "success" : "danger"}>
                {health.status.toUpperCase()}
              </Badge>
            )
          }
        />
        <CardBody>
          {healthQuery.isLoading ? (
            <LoadingRows rows={2} />
          ) : !health ? (
            <p className="text-xs text-muted">Unable to load health status.</p>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {Object.entries(health.services).map(([serviceName, info]) => {
                const isOk = info.status === "ok";
                return (
                  <div
                    key={serviceName}
                    className="flex flex-col justify-between rounded-lg border border-border/80 p-3 bg-surface"
                  >
                    <div className="flex items-center justify-between text-xs font-semibold capitalize text-foreground">
                      <span>{serviceName.replace("_", " ")}</span>
                      {isOk ? (
                        <CheckCircle2 className="size-3.5 text-success" />
                      ) : (
                        <XCircle className="size-3.5 text-danger" />
                      )}
                    </div>
                    <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
                      <Badge tone={isOk ? "success" : "danger"} className="text-[10px]">
                        {info.status}
                      </Badge>
                      {info.latency_ms !== undefined && (
                        <span className="font-mono">{info.latency_ms}ms</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Tenant Organizations */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Tenant Organizations</h2>
            <p className="text-xs text-muted">
              Search organizations, override tier quotas, and manage operational suspensions.
            </p>
          </div>

          {/* Search & Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Search orgs…"
                className="pl-8 h-8 text-xs w-48"
              />
            </div>

            <NativeSelect
              value={planFilter}
              onChange={(e) => {
                setPlanFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 text-xs w-28"
            >
              <option value="">All Plans</option>
              <option value="free">Free</option>
              <option value="starter">Starter</option>
              <option value="growth">Growth</option>
              <option value="business">Business</option>
            </NativeSelect>

            <NativeSelect
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="h-8 text-xs w-32"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
            </NativeSelect>
          </div>
        </div>

        {orgsQuery.isLoading ? (
          <LoadingRows rows={6} />
        ) : orgsQuery.error ? (
          <ErrorState message={errorMessage(orgsQuery.error)} onRetry={() => void orgsQuery.refetch()} />
        ) : !orgsQuery.data?.items.length ? (
          <EmptyState
            icon={Building2}
            title="No organizations found"
            description="No tenant organizations match the current filter criteria."
          />
        ) : (
          <Card>
            <Table>
              <THead>
                <TR>
                  <TH>Organization</TH>
                  <TH>Plan</TH>
                  <TH>Status</TH>
                  <TH>Resources</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {orgsQuery.data.items.map((item) => (
                  <TR key={item.id}>
                    <TD className="font-medium text-foreground">
                      <div>{item.name}</div>
                      <div className="font-mono text-[11px] text-muted">{item.slug}</div>
                    </TD>
                    <TD>
                      <Badge tone="neutral" className="capitalize">
                        {item.plan_name}
                      </Badge>
                      {item.trial_ends_at && (
                        <div className="text-[10px] text-warning mt-0.5">Trial</div>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={item.status === "active" ? "success" : "danger"}>
                        {item.status}
                      </Badge>
                    </TD>
                    <TD className="text-xs text-muted">
                      <div>{item.members_count} members</div>
                      <div>{item.workflows_count} workflows · {item.channels_count} channels</div>
                    </TD>
                    <TD className="text-xs text-muted">{formatDate(item.created_at)}</TD>
                    <TD className="text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => setInspectOrgId(item.id)}
                          title="Inspect details"
                        >
                          <Eye className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => {
                            setAssignPlanOrg(item);
                            setTargetPlanKey(item.plan_key);
                          }}
                          title="Override Plan"
                        >
                          <Sliders className="size-3.5" />
                        </Button>
                        {item.status === "active" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-danger hover:text-danger hover:bg-danger-soft/20"
                            onClick={() => setSuspendOrg(item)}
                            title="Suspend Organization"
                          >
                            <PauseCircle className="size-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs px-2 text-success hover:text-success hover:bg-success-soft/20"
                            onClick={() => setRestoreOrgTarget(item)}
                            title="Restore Organization"
                          >
                            <PlayCircle className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            {/* Pagination */}
            {orgsQuery.data.total > 15 && (
              <div className="flex items-center justify-between border-t px-4 py-3 text-xs text-muted">
                <span>
                  Showing {((page - 1) * 15) + 1} to{" "}
                  {Math.min(page * 15, orgsQuery.data.total)} of {orgsQuery.data.total} organizations
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={page * 15 >= orgsQuery.data.total}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* DIALOG: Inspect Organization Detail */}
      <Dialog
        open={!!inspectOrgId}
        onOpenChange={() => setInspectOrgId(null)}
        title={orgDetailQuery.data ? `Tenant: ${orgDetailQuery.data.name}` : "Organization Details"}
        description="Operational overview, active quotas, and cross-tenant audit log."
        size="lg"
        footer={
          <Button variant="secondary" onClick={() => setInspectOrgId(null)}>
            Close
          </Button>
        }
      >
        {orgDetailQuery.isLoading ? (
          <LoadingRows rows={5} />
        ) : !orgDetailQuery.data ? (
          <p className="text-xs text-muted">Unable to load details.</p>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 rounded-lg border bg-surface-muted/40 p-3">
              <div>
                <span className="text-[11px] text-muted">Status</span>
                <div className="font-semibold text-xs text-foreground capitalize">
                  {orgDetailQuery.data.status}
                </div>
              </div>
              <div>
                <span className="text-[11px] text-muted">Plan</span>
                <div className="font-semibold text-xs text-foreground">
                  {orgDetailQuery.data.plan?.name ?? "None"}
                </div>
              </div>
              <div>
                <span className="text-[11px] text-muted">Team Members</span>
                <div className="font-semibold text-xs text-foreground">
                  {orgDetailQuery.data.members_count}
                </div>
              </div>
              <div>
                <span className="text-[11px] text-muted">Created</span>
                <div className="font-semibold text-xs text-foreground">
                  {formatDate(orgDetailQuery.data.created_at)}
                </div>
              </div>
            </div>

            {orgDetailQuery.data.suspended_reason && (
              <div className="rounded border border-danger/40 bg-danger-soft/20 p-3 text-xs text-danger">
                <span className="font-semibold">Suspended Reason:</span> {orgDetailQuery.data.suspended_reason}
              </div>
            )}

            {/* Current Resource Usage */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Current Resource Counters</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Object.entries(orgDetailQuery.data.current_usage).map(([key, val]) => (
                  <div key={key} className="rounded border p-2 text-xs">
                    <span className="text-[11px] text-muted capitalize">{key.replace("_", " ")}</span>
                    <div className="font-mono font-semibold text-foreground mt-0.5">{val.toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Audit Events */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">Recent Audit Trail</h4>
              {!orgDetailQuery.data.recent_audit_events.length ? (
                <p className="text-xs text-muted">No recent audit logs.</p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded border">
                  <Table>
                    <THead>
                      <TR>
                        <TH>Action</TH>
                        <TH>Actor</TH>
                        <TH>Time</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {orgDetailQuery.data.recent_audit_events.map((evt) => (
                        <TR key={evt.id}>
                          <TD className="font-mono text-xs">{evt.action}</TD>
                          <TD className="text-xs text-muted">{evt.actor_email || "System"}</TD>
                          <TD className="text-xs text-muted">{formatDate(evt.created_at)}</TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* DIALOG: Assign Plan Override */}
      <Dialog
        open={!!assignPlanOrg}
        onOpenChange={() => setAssignPlanOrg(null)}
        title={`Assign Plan · ${assignPlanOrg?.name ?? ""}`}
        description="Override the subscription tier and extend complimentary trial duration."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setAssignPlanOrg(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => assignPlanMutation.mutate()}
              disabled={assignPlanMutation.isPending}
            >
              {assignPlanMutation.isPending ? "Assigning…" : "Update Plan"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Target Plan">
            <NativeSelect
              value={targetPlanKey}
              onChange={(e) => setTargetPlanKey(e.target.value)}
            >
              <option value="free">Free Tier</option>
              <option value="starter">Starter Plan</option>
              <option value="growth">Growth Plan</option>
              <option value="business">Business Plan</option>
            </NativeSelect>
          </Field>

          <Field label="Trial Period (Optional)" hint="Grant trial days from today (1–365)">
            <Input
              type="number"
              min={1}
              max={365}
              value={trialDays ?? ""}
              onChange={(e) => setTrialDays(e.target.value ? parseInt(e.target.value, 10) : undefined)}
              placeholder="e.g. 30"
            />
          </Field>
        </div>
      </Dialog>

      {/* DIALOG: Suspend Organization */}
      <Dialog
        open={!!suspendOrg}
        onOpenChange={() => setSuspendOrg(null)}
        title={`Suspend Organization · ${suspendOrg?.name ?? ""}`}
        description="Freezes outgoing messages, schedule executions, and workflow triggers for this tenant."
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setSuspendOrg(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => suspendMutation.mutate()}
              disabled={!suspendReason.trim() || suspendMutation.isPending}
            >
              {suspendMutation.isPending ? "Suspending…" : "Suspend Organization"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Reason for Suspension" hint="Required audit note explaining action">
            <Input
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="e.g. Terms violation, non-payment, suspicious outbound spam"
            />
          </Field>
        </div>
      </Dialog>

      {/* CONFIRM: Restore Organization */}
      <ConfirmDialog
        open={!!restoreOrgTarget}
        onOpenChange={() => setRestoreOrgTarget(null)}
        title="Restore Organization?"
        description={`Are you sure you want to reactivate "${restoreOrgTarget?.name}"? Scheduled workflows and channel connectivity will resume immediately.`}
        confirmLabel="Restore Organization"
        onConfirm={() => {
          if (restoreOrgTarget) restoreMutation.mutate(restoreOrgTarget.id);
        }}
        loading={restoreMutation.isPending}
      />
    </div>
  );
}
