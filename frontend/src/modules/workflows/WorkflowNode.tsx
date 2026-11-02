import { Handle, type Node, type NodeProps, Position } from "@xyflow/react";
import { AlertCircle, AlertTriangle, CheckCircle2, CircleDashed, Clock, Loader2, XCircle } from "lucide-react";
import { createContext, memo, useContext } from "react";
import type { NodeRun, NodeType } from "@/types/api";
import { cn } from "@/utils/cn";
import { CATEGORIES, type Lookups, summarize } from "./meta";

export type FlowNodeData = { nodeType: string; config: Record<string, unknown> };
export type WflowNode = Node<FlowNodeData, "wflow">;

/** Things every card needs that must not be saved into the definition. */
export type CanvasInfo = {
  types: Map<string, NodeType>;
  lookups: Lookups;
  issues: Map<string, "error" | "warning">;
  runNodes: Map<string, NodeRun>;
};

export const CanvasContext = createContext<CanvasInfo | null>(null);

const RUN_ICON = {
  running: <Loader2 className="size-3.5 animate-spin text-info" aria-label="Running" />,
  waiting: <Clock className="size-3.5 text-warning" aria-label="Waiting" />,
  completed: <CheckCircle2 className="size-3.5 text-success" aria-label="Completed" />,
  skipped: <CircleDashed className="size-3.5 text-muted" aria-label="Skipped" />,
  failed: <XCircle className="size-3.5 text-danger" aria-label="Failed" />,
  cancelled: <CircleDashed className="size-3.5 text-muted" aria-label="Cancelled" />,
};

function WorkflowNodeView({ id, data, selected }: NodeProps<WflowNode>) {
  const info = useContext(CanvasContext)!;
  const def = info.types.get(data.nodeType);
  const issue = info.issues.get(id);
  const run = info.runNodes.get(id);
  if (!def) {
    return <div className="rounded-md border border-danger bg-surface px-3 py-2 text-xs text-danger">Unknown step: {data.nodeType}</div>;
  }
  const cat = CATEGORIES[def.category];
  const Icon = cat.icon;
  const isTrigger = def.category === "trigger";
  const multi = def.outputs.length > 1;

  return (
    <div
      className={cn(
        "w-60 rounded-lg border bg-surface text-left shadow-sm transition-shadow",
        selected ? "border-primary ring-2 ring-primary/20" : "border-border-strong",
        issue === "error" && !selected && "border-danger",
        run?.status === "failed" && "border-danger ring-2 ring-danger/15",
      )}
    >
      {!isTrigger && <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !border-surface !bg-subtle" />}
      <div className="flex items-start gap-2 px-3 py-2.5">
        <span className={cn("mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md", cat.accent)}>
          <Icon className="size-3.5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted">{isTrigger ? "When" : cat.label.replace(/s$/, "")}</p>
            <span className="ml-auto flex items-center gap-1">
              {issue === "error" && <AlertCircle className="size-3.5 text-danger" aria-label="Has a problem" />}
              {issue === "warning" && <AlertTriangle className="size-3.5 text-warning" aria-label="Has a warning" />}
              {run && RUN_ICON[run.status]}
            </span>
          </div>
          <p className="truncate text-[13px] font-medium">{def.label}</p>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted">{summarize(def, data.config, info.lookups)}</p>
        </div>
      </div>
      {def.outputs.length > 0 &&
        (multi ? (
          <div className="border-t">
            {def.outputs.map((o) => (
              <div key={o.handle} className="relative flex h-6 items-center justify-end pr-3 text-[11px] text-muted">
                <span className={cn(run?.outcome === o.handle && "font-semibold text-foreground")}>{o.label}</span>
                <Handle
                  type="source"
                  id={o.handle}
                  position={Position.Right}
                  className="!size-2.5 !border-2 !border-surface !bg-primary"
                />
              </div>
            ))}
          </div>
        ) : (
          <Handle
            type="source"
            id={def.outputs[0]?.handle}
            position={Position.Right}
            className="!size-2.5 !border-2 !border-surface !bg-primary"
          />
        ))}
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeView);
export const nodeTypes = { wflow: WorkflowNode };
