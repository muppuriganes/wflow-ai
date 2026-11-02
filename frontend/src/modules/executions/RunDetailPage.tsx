import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { ErrorState, LoadingRows } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { NodeRun } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";
import { CATEGORIES, formatDuration, NODE_RUN_TONE, RUN_STATUS, useNodeTypes, WAITING_LABEL } from "../workflows/meta";

const FINISHED = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"]);
const RETRYABLE = new Set(["FAILED", "CANCELLED", "TIMED_OUT"]);

export function RunDetailPage() {
  const { runId } = useParams();
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const types = useNodeTypes(org.id);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const run = useQuery({
    queryKey: orgKeys.scoped(org.id, "run", runId),
    queryFn: () => workflowsApi.run(org.id, runId!),
    refetchInterval: (q) => (q.state.data && FINISHED.has(q.state.data.status) ? false : 2000),
  });
  const retry = useMutation({
    mutationFn: () => workflowsApi.retryRun(org.id, runId!),
    onSuccess: (r) => {
      toast.success("Started a new run with the same input");
      navigate(`/executions/${r.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const cancel = useMutation({
    mutationFn: () => workflowsApi.cancelRun(org.id, runId!),
    onSuccess: () => {
      setConfirmCancel(false);
      toast.success("Cancelling the run");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "run", runId) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (run.isLoading) return <LoadingRows rows={6} />;
  if (run.error || !run.data) return <ErrorState message={errorMessage(run.error)} onRetry={() => void run.refetch()} />;
  const r = run.data;
  const st = RUN_STATUS[r.status];
  const canManage = org.can("executions.manage");
  const labelFor = (n: NodeRun) => types.data?.get(n.node_type)?.label ?? n.node_type;

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/executions" aria-label="Back to execution logs">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{r.workflow_name}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
            {r.is_test && <Badge tone="info">Test run</Badge>}
          </div>
          <p className="mt-0.5 text-[13px] text-muted">
            {r.version ? `Version ${r.version} · ` : ""}
            {types.data?.get(r.trigger_type)?.label ?? r.trigger_type} · started {formatDateTime(r.created_at)} · {formatDuration(r.duration_ms)}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" asChild>
            <Link to={`/workflows/${r.workflow_id}`}>Open workflow</Link>
          </Button>
          {canManage && !FINISHED.has(r.status) && (
            <Button variant="danger-outline" onClick={() => setConfirmCancel(true)}>
              <Square /> Cancel
            </Button>
          )}
          {canManage && RETRYABLE.has(r.status) && !r.is_test && (
            <Button onClick={() => retry.mutate()} loading={retry.isPending}>
              <RotateCcw /> Retry
            </Button>
          )}
        </div>
      </div>

      {r.waiting_for && (
        <p className="mb-4 rounded-md border border-warning/25 bg-warning-soft px-3 py-2 text-xs text-warning">
          {WAITING_LABEL[r.waiting_for]}.
          {r.waiting_for === "approval" && (
            <>
              {" "}
              <Link to="/executions?tab=approvals" className="underline">
                Review approvals
              </Link>
            </>
          )}
        </p>
      )}
      {r.error && <p className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger">{r.error}</p>}
      {r.retry_of_run_id && (
        <p className="mb-4 text-xs text-muted">
          Retry of{" "}
          <Link to={`/executions/${r.retry_of_run_id}`} className="text-primary hover:underline">
            an earlier run
          </Link>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <h2 className="border-b px-4 py-2.5 text-[13px] font-semibold">Steps</h2>
          {r.nodes.length === 0 ? (
            <p className="px-4 py-6 text-xs text-muted">No steps have run yet.</p>
          ) : (
            <ol>
              {r.nodes.map((n, i) => (
                <StepRow key={n.node_id} node={n} index={i + 1} label={labelFor(n)} category={types.data?.get(n.node_type)?.category} />
              ))}
            </ol>
          )}
        </Card>
        <Card className="h-fit">
          <h2 className="border-b px-4 py-2.5 text-[13px] font-semibold">Trigger input</h2>
          <dl className="space-y-1.5 px-4 py-3 text-xs">
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Contact</dt>
              <dd>{r.contact_name ?? "—"}</dd>
            </div>
            {r.conversation_id && (
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Conversation</dt>
                <dd>
                  <Link to={`/inbox/${r.conversation_id}`} className="text-primary hover:underline">
                    Open in inbox
                  </Link>
                </dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Finished</dt>
              <dd>{r.finished_at ? formatDateTime(r.finished_at) : "—"}</dd>
            </div>
          </dl>
          <Json value={r.trigger_payload} />
        </Card>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this run?"
        description="The remaining steps won't run. Steps that already ran are not undone."
        confirmLabel="Cancel run"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </>
  );
}

function StepRow({ node: n, index, label, category }: { node: NodeRun; index: number; label: string; category?: keyof typeof CATEGORIES }) {
  const [open, setOpen] = useState(n.status === "failed");
  const cat = category ? CATEGORIES[category] : null;
  const summary = typeof n.output.description === "string" ? n.output.description : typeof n.output.note === "string" ? n.output.note : null;
  const duration = n.started_at && n.finished_at ? new Date(n.finished_at).getTime() - new Date(n.started_at).getTime() : null;
  return (
    <li className="border-b last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-surface-muted/50">
        <span className="mt-0.5 w-5 text-right text-xs text-subtle">{index}</span>
        {cat && (
          <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm", cat.accent)}>
            <cat.icon className="size-3" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium">{label}</span>
            <StatusDot tone={NODE_RUN_TONE[n.status]} label={n.status} />
            {n.outcome && n.outcome !== "out" && <span className="text-xs text-muted">→ {n.outcome}</span>}
            {n.attempt > 1 && <span className="text-xs text-warning">{n.attempt} attempts</span>}
          </div>
          {summary && <p className="mt-0.5 text-xs text-muted">{summary}</p>}
          {n.error && <p className="mt-0.5 text-xs text-danger">{n.error}</p>}
        </div>
        <span className="text-xs text-muted">{duration !== null ? formatDuration(duration) : ""}</span>
        <ChevronDown className={cn("mt-0.5 size-4 text-subtle transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && (
        <div className="grid gap-3 px-12 pb-3 md:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Input</p>
            <Json value={n.input} />
          </div>
          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">Output</p>
            <Json value={n.output} />
          </div>
        </div>
      )}
    </li>
  );
}

function Json({ value }: { value: unknown }) {
  const empty = value === null || (typeof value === "object" && Object.keys(value as object).length === 0);
  return (
    <pre className="max-h-72 overflow-auto rounded-md bg-surface-muted px-3 py-2 text-[11px] leading-relaxed">
      {empty ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  );
}
