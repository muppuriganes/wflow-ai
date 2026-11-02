import { useMutation } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { useCurrentOrg } from "@/stores/organization";
import type { NodeType, RunDetail, Validation, WorkflowDetail } from "@/types/api";
import { formatRelative } from "@/utils/format";
import { NODE_RUN_TONE, RUN_STATUS, WAITING_LABEL } from "./meta";
import { TestRunDialog } from "./TestRunDialog";

type Props = {
  workflow: WorkflowDetail;
  trigger: NodeType | undefined;
  validation: Validation | null;
  testRun: RunDetail | null;
  canEdit: boolean;
  canPublish: boolean;
  onSelectNode: (id: string) => void;
  onDescription: (description: string | null) => void;
  onWorkflow: (wf: WorkflowDetail) => void;
  onClearTest: () => void;
};

/** Side panel shown when no step is selected: overview, problems, trigger details, last test. */
export function WorkflowPanel({ workflow, trigger, validation, testRun, canEdit, canPublish, onSelectNode, onDescription, onWorkflow, onClearTest }: Props) {
  const org = useCurrentOrg();
  const [description, setDescription] = useState(workflow.description ?? "");
  const [runOpen, setRunOpen] = useState(false);
  useEffect(() => setDescription(workflow.description ?? ""), [workflow.description]);

  const regenerate = useMutation({
    mutationFn: () => workflowsApi.regenerateWebhook(org.id, workflow.id),
    onSuccess: (wf) => {
      onWorkflow({ ...wf, definition: workflow.definition });
      toast.success("New webhook address created — the old one no longer works");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const isManual = trigger?.type === "trigger.manual";

  return (
    <div className="h-full space-y-5 overflow-y-auto px-4 py-4">
      <section>
        <h2 className="mb-1.5 text-xs font-medium">Description</h2>
        <textarea
          className="min-h-16 w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none disabled:bg-surface-muted"
          placeholder="What does this workflow do?"
          value={description}
          maxLength={500}
          disabled={!canEdit}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => {
            const v = description.trim() || null;
            if (v !== (workflow.description ?? null)) onDescription(v);
          }}
        />
      </section>

      <section>
        <h2 className="mb-1.5 text-xs font-medium">Checks</h2>
        {!validation ? (
          <p className="text-xs text-muted">Checking…</p>
        ) : validation.ok && !validation.warnings.length ? (
          <p className="flex items-center gap-1.5 text-xs text-success">
            <CheckCircle2 className="size-4" /> Ready to publish
          </p>
        ) : (
          <ul className="space-y-1">
            {validation.errors.map((i, n) => (
              <IssueRow key={`e${n}`} kind="error" message={i.message} onClick={i.node_id ? () => onSelectNode(i.node_id!) : undefined} />
            ))}
            {validation.warnings.map((i, n) => (
              <IssueRow key={`w${n}`} kind="warning" message={i.message} onClick={i.node_id ? () => onSelectNode(i.node_id!) : undefined} />
            ))}
          </ul>
        )}
      </section>

      {trigger && (
        <section>
          <h2 className="mb-1.5 text-xs font-medium">Starts when</h2>
          <p className="text-xs text-muted">{trigger.description}</p>
          {trigger.type === "trigger.webhook" &&
            (workflow.webhook_url ? (
              <div className="mt-2 space-y-1.5">
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate rounded-sm bg-surface-muted px-1.5 py-1 text-[11px]" title={workflow.webhook_url}>
                    {workflow.webhook_url}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copy webhook address"
                    onClick={() => void navigator.clipboard.writeText(workflow.webhook_url!).then(() => toast.success("Copied"))}
                  >
                    <Copy />
                  </Button>
                </div>
                <p className="text-[11px] text-muted">POST a JSON object. Send an Idempotency-Key header to avoid duplicate runs. Keep this address secret.</p>
                {canPublish && (
                  <Button variant="secondary" size="sm" onClick={() => regenerate.mutate()} loading={regenerate.isPending}>
                    <RefreshCw /> New address
                  </Button>
                )}
              </div>
            ) : (
              <p className="mt-1.5 text-[11px] text-muted">
                {canPublish ? "The webhook address appears here after you publish." : "Ask someone who can publish for the webhook address."}
              </p>
            ))}
          {isManual && workflow.published_version && workflow.status === "active" && canEdit && (
            <Button className="mt-2" variant="secondary" size="sm" onClick={() => setRunOpen(true)}>
              <Play /> Run now
            </Button>
          )}
        </section>
      )}

      {testRun && (
        <section>
          <div className="mb-1.5 flex items-center gap-2">
            <h2 className="text-xs font-medium">{testRun.is_test ? "Test run" : "Latest run"}</h2>
            <Badge tone={RUN_STATUS[testRun.status].tone}>{RUN_STATUS[testRun.status].label}</Badge>
            <Button variant="ghost" size="icon" className="ml-auto size-6" onClick={onClearTest} aria-label="Clear run results">
              <X />
            </Button>
          </div>
          {testRun.waiting_for && <p className="mb-1.5 text-xs text-muted">{WAITING_LABEL[testRun.waiting_for]}</p>}
          {testRun.error && <p className="mb-1.5 rounded-md bg-danger-soft px-2 py-1.5 text-xs text-danger">{testRun.error}</p>}
          <ol className="space-y-1.5">
            {testRun.nodes.map((n) => {
              const text = typeof n.output.description === "string" ? n.output.description : typeof n.output.note === "string" ? n.output.note : null;
              return (
                <li key={n.node_id}>
                  <button type="button" onClick={() => onSelectNode(n.node_id)} className="w-full rounded-md border px-2 py-1.5 text-left hover:bg-surface-muted">
                    <div className="flex items-center gap-2">
                      <StatusDot tone={NODE_RUN_TONE[n.status]} label={(n.node_type.split(".")[1] ?? n.node_type).replace(/_/g, " ")} />
                      {n.outcome && n.outcome !== "out" && <span className="ml-auto text-[11px] text-muted">→ {n.outcome}</span>}
                    </div>
                    {text && <p className="mt-0.5 text-xs text-muted">{text}</p>}
                    {n.error && <p className="mt-0.5 text-xs text-danger">{n.error}</p>}
                  </button>
                </li>
              );
            })}
          </ol>
          <Link to={`/executions/${testRun.id}`} className="mt-2 inline-block text-xs text-primary hover:underline">
            Open full details
          </Link>
        </section>
      )}

      <section className="text-xs text-muted">
        <p>Last 7 days: {workflow.stats.total_7d} runs{workflow.stats.failed_7d ? `, ${workflow.stats.failed_7d} failed` : ""}</p>
        {workflow.stats.last_run_at && <p>Last run {formatRelative(workflow.stats.last_run_at)}</p>}
      </section>

      {isManual && (
        <TestRunDialog open={runOpen} onOpenChange={setRunOpen} workflow={workflow} trigger={trigger} mode="live" onProgress={() => undefined} />
      )}
    </div>
  );
}

function IssueRow({ kind, message, onClick }: { kind: "error" | "warning"; message: string; onClick?: () => void }) {
  const Icon = kind === "error" ? AlertCircle : AlertTriangle;
  return (
    <li>
      <button
        type="button"
        disabled={!onClick}
        onClick={onClick}
        className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs enabled:hover:bg-surface-muted"
      >
        <Icon className={kind === "error" ? "mt-px size-3.5 shrink-0 text-danger" : "mt-px size-3.5 shrink-0 text-warning"} />
        <span>{message}</span>
      </button>
    </li>
  );
}
