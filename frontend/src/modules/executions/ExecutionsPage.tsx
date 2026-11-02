import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CheckCircle2, ChevronLeft, ChevronRight, UserCheck } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { usePollInterval } from "@/stores/live";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Approval, RunStatus } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";
import { formatDuration, RUN_STATUS, useNodeTypes, WAITING_LABEL } from "../workflows/meta";

export function ExecutionsPage() {
  const org = useCurrentOrg();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "approvals" ? "approvals" : "runs";
  const pending = useQuery({
    queryKey: orgKeys.scoped(org.id, "approvals", "pending"),
    queryFn: () => workflowsApi.approvals(org.id, "pending"),
  });

  return (
    <>
      <PageHeader title="Execution Logs" description="Every workflow run, step by step — plus the approvals waiting on your team." />
      <div className="mb-4 flex gap-1 border-b" role="tablist">
        {(["runs", "approvals"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setParams(t === "runs" ? {} : { tab: t })}
            className={cn(
              "-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium",
              tab === t ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground",
            )}
          >
            {t === "runs" ? "Runs" : "Approvals"}
            {t === "approvals" && !!pending.data?.length && (
              <Badge tone="warning" className="ml-1.5">
                {pending.data.length}
              </Badge>
            )}
          </button>
        ))}
      </div>
      {tab === "runs" ? <RunsTab /> : <ApprovalsTab />}
    </>
  );
}

function RunsTab() {
  const org = useCurrentOrg();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1);
  const workflowId = params.get("workflow") ?? undefined;
  const status = (params.get("status") as RunStatus | null) ?? undefined;
  const includeTests = params.get("tests") === "1";
  const types = useNodeTypes(org.id);
  const poll = usePollInterval(5000);
  const workflows = useQuery({ queryKey: orgKeys.scoped(org.id, "workflows", true), queryFn: () => workflowsApi.list(org.id, true) });
  const runs = useQuery({
    queryKey: orgKeys.scoped(org.id, "runs", workflowId, status, includeTests, page),
    queryFn: () => workflowsApi.runs(org.id, { workflow_id: workflowId, status, include_tests: includeTests, page }),
    refetchInterval: poll,
  });
  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
    setPage(1);
  };
  const pages = runs.data ? Math.max(1, Math.ceil(runs.data.total / runs.data.page_size)) : 1;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <NativeSelect className="w-52" aria-label="Workflow" value={workflowId ?? ""} onChange={(e) => setFilter("workflow", e.target.value || undefined)}>
          <option value="">All workflows</option>
          {(workflows.data ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect className="w-40" aria-label="Status" value={status ?? ""} onChange={(e) => setFilter("status", e.target.value || undefined)}>
          <option value="">Any status</option>
          {Object.entries(RUN_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </NativeSelect>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input type="checkbox" checked={includeTests} onChange={(e) => setFilter("tests", e.target.checked ? "1" : undefined)} />
          Include test runs
        </label>
      </div>
      {runs.isLoading ? (
        <LoadingRows rows={5} />
      ) : runs.error ? (
        <ErrorState message={errorMessage(runs.error)} onRetry={() => void runs.refetch()} />
      ) : !runs.data?.items.length ? (
        <EmptyState
          icon={Activity}
          title="No runs yet"
          description="Runs appear here as soon as a published workflow is triggered."
          action={
            <Button variant="secondary" asChild>
              <Link to="/workflows">Go to workflows</Link>
            </Button>
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Workflow</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Trigger</TH>
                <TH className="hidden md:table-cell">Contact</TH>
                <TH className="hidden lg:table-cell">Steps</TH>
                <TH className="hidden lg:table-cell">Duration</TH>
                <TH>Started</TH>
              </TR>
            </THead>
            <TBody>
              {runs.data.items.map((r) => {
                const st = RUN_STATUS[r.status];
                return (
                  <TR key={r.id} className="hover:bg-surface-muted/50">
                    <TD>
                      <Link to={`/executions/${r.id}`} className="font-medium hover:underline">
                        {r.workflow_name}
                      </Link>
                      <span className="ml-1.5 text-xs text-muted">{r.is_test ? "test" : r.version ? `v${r.version}` : ""}</span>
                    </TD>
                    <TD>
                      <Badge tone={st.tone}>{st.label}</Badge>
                      {r.waiting_for && <p className="mt-0.5 text-[11px] text-muted">{WAITING_LABEL[r.waiting_for]}</p>}
                    </TD>
                    <TD className="hidden text-muted md:table-cell">{types.data?.get(r.trigger_type)?.label ?? r.trigger_type}</TD>
                    <TD className="hidden md:table-cell">{r.contact_name ?? <span className="text-muted">—</span>}</TD>
                    <TD className="hidden lg:table-cell">
                      {r.node_count}
                      {r.failed_nodes > 0 && <span className="ml-1.5 text-xs text-danger">{r.failed_nodes} failed</span>}
                      {r.retries > 0 && <span className="ml-1.5 text-xs text-muted">{r.retries} retries</span>}
                    </TD>
                    <TD className="hidden text-muted lg:table-cell">{formatDuration(r.duration_ms)}</TD>
                    <TD className="text-muted" title={formatDateTime(r.created_at)}>
                      {formatRelative(r.created_at)}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted">
              Page {page} of {pages}
              <Button variant="ghost" size="icon" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                <ChevronRight />
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function ApprovalsTab() {
  const org = useCurrentOrg();
  const [status, setStatus] = useState("pending");
  const approvals = useQuery({
    queryKey: orgKeys.scoped(org.id, "approvals", status),
    queryFn: () => workflowsApi.approvals(org.id, status || undefined),
    refetchInterval: usePollInterval(10_000),
  });

  return (
    <Card>
      <div className="flex border-b p-3">
        <NativeSelect className="w-40" aria-label="Approval status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">Waiting</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="expired">Expired</option>
          <option value="">All</option>
        </NativeSelect>
      </div>
      {approvals.isLoading ? (
        <LoadingRows rows={3} />
      ) : approvals.error ? (
        <ErrorState message={errorMessage(approvals.error)} onRetry={() => void approvals.refetch()} />
      ) : !approvals.data?.length ? (
        <EmptyState
          icon={status === "pending" ? CheckCircle2 : UserCheck}
          title={status === "pending" ? "Nothing waiting for approval" : "No approvals here"}
          description="Workflows with an “Ask for approval” step pause here until someone decides."
        />
      ) : (
        <ul className="divide-y">
          {approvals.data.map((a) => (
            <ApprovalRow key={a.id} approval={a} />
          ))}
        </ul>
      )}
    </Card>
  );
}

const APPROVAL_TONE = { pending: "warning", approved: "success", rejected: "danger", expired: "neutral", cancelled: "neutral" } as const;

function ApprovalRow({ approval: a }: { approval: Approval }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected") => workflowsApi.decide(org.id, a.id, decision, note),
    onSuccess: (res) => {
      toast.success(res.status === "approved" ? "Approved — the workflow continues" : "Rejected");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "approvals") });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const canDecide = org.can("approvals.decide") && a.status === "pending";

  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[13px] font-medium">{a.title}</p>
          <Badge tone={APPROVAL_TONE[a.status]}>{a.status === "pending" ? "Waiting" : a.status.charAt(0).toUpperCase() + a.status.slice(1)}</Badge>
        </div>
        {a.details && <p className="mt-0.5 whitespace-pre-wrap text-xs text-foreground/80">{a.details}</p>}
        <p className="mt-1 text-xs text-muted">
          <Link to={`/executions/${a.run_id}`} className="hover:underline">
            {a.workflow_name}
          </Link>
          {" · "}
          {formatRelative(a.created_at)}
          {a.assignee && ` · for ${a.assignee}`}
          {a.status === "pending" && a.expires_at && ` · expires ${formatRelative(a.expires_at)}`}
          {a.decided_by && ` · ${a.status} by ${a.decided_by}`}
        </p>
        {a.decision_note && <p className="mt-0.5 text-xs italic text-muted">“{a.decision_note}”</p>}
      </div>
      {canDecide && (
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <input
            className="h-7 min-w-0 flex-1 rounded-md border border-border-strong px-2 text-xs sm:w-44"
            placeholder="Note (optional)"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-label="Decision note"
          />
          <Button size="sm" variant="danger-outline" disabled={decide.isPending} onClick={() => decide.mutate("rejected")}>
            Reject
          </Button>
          <Button size="sm" loading={decide.isPending && decide.variables === "approved"} disabled={decide.isPending} onClick={() => decide.mutate("approved")}>
            Approve
          </Button>
        </div>
      )}
    </li>
  );
}
