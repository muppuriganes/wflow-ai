import "@xyflow/react/dist/style.css";
import { Background, Controls, type Edge, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useLookups, useNodeTypes } from "@/modules/workflows/meta";
import { type CanvasInfo, CanvasContext, nodeTypes, type WflowNode } from "@/modules/workflows/WorkflowNode";
import { useCurrentOrg } from "@/stores/organization";
import type { WorkflowDefinition, WorkflowTemplate } from "@/types/api";

type Props = {
  template: WorkflowTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUseTemplate: (template: WorkflowTemplate) => void;
  isCreating?: boolean;
};

const EDGE_STYLE = { type: "smoothstep", style: { strokeWidth: 1.5 } } as const;

function FlowCanvas({ definition, info }: { definition: WorkflowDefinition; info: CanvasInfo }) {
  const nodes: WflowNode[] = useMemo(
    () => (definition.nodes || []).map((n) => ({ id: n.id, type: "wflow", position: n.position, data: n.data })),
    [definition.nodes],
  );

  const edges: Edge[] = useMemo(
    () => (definition.edges || []).map((e) => ({ ...e, ...EDGE_STYLE })),
    [definition.edges],
  );

  return (
    <CanvasContext.Provider value={info}>
      <div className="h-[420px] w-full rounded-md border border-border-strong bg-surface">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

export function TemplatePreviewModal({ template, open, onOpenChange, onUseTemplate, isCreating }: Props) {
  const org = useCurrentOrg();
  const types = useNodeTypes(org.id);
  const lookups = useLookups(org.id);

  const canvasInfo: CanvasInfo = useMemo(
    () => ({
      types: types.data ?? new Map(),
      lookups,
      issues: new Map(),
      runNodes: new Map(),
    }),
    [types.data, lookups],
  );

  if (!template) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={template.name}
      size="xl"
      description={
        <div className="flex items-center gap-2 mt-1">
          <Badge tone="neutral" className="capitalize">
            {template.category}
          </Badge>
          <span>{template.description}</span>
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button
            onClick={() => onUseTemplate(template)}
            disabled={isCreating}
          >
            <Sparkles className="size-3.5" />
            {isCreating ? "Creating workflow…" : "Use this template"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <ReactFlowProvider>
          <FlowCanvas definition={template.definition} info={canvasInfo} />
        </ReactFlowProvider>
        <div className="rounded-md bg-surface-muted/50 p-2.5 text-xs text-muted">
          💡 After creating this workflow from the template, review the step configurations (e.g. tags, WhatsApp
          channel, team members) to adapt it to your team's exact workflow.
        </div>
      </div>
    </Dialog>
  );
}
