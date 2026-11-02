import "@xyflow/react/dist/style.css";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  FlaskConical,
  History,
  MoreHorizontal,
  Pause,
  Play,
  Redo2,
  Rocket,
  Search,
  Undo2,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ErrorState, Spinner } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { FlowEdge, FlowNode, NodeType, RunDetail, Validation, WorkflowDefinition, WorkflowDetail } from "@/types/api";
import { cn } from "@/utils/cn";
import { ConfigPanel } from "./ConfigPanel";
import { CATEGORIES, CATEGORY_ORDER, defaultConfig, useLookups, useNodeTypes, WORKFLOW_STATUS } from "./meta";
import { TestRunDialog } from "./TestRunDialog";
import { VersionsDialog } from "./VersionsDialog";
import { WorkflowPanel } from "./WorkflowPanel";
import { type CanvasInfo, CanvasContext, nodeTypes, type WflowNode } from "./WorkflowNode";

const DRAG_TYPE = "application/x-wflow-step";
const EDGE_STYLE = { type: "smoothstep", style: { strokeWidth: 1.5 } } as const;

type Snapshot = { nodes: WflowNode[]; edges: Edge[] };

function newId(): string {
  return `n_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function toFlow(def: WorkflowDefinition): Snapshot {
  return {
    nodes: def.nodes.map((n) => ({ id: n.id, type: "wflow", position: n.position, data: n.data })),
    edges: def.edges.map((e) => ({ ...e, ...EDGE_STYLE })),
  };
}

function toDefinition(nodes: WflowNode[], edges: Edge[]): WorkflowDefinition {
  return {
    nodes: nodes.map<FlowNode>((n) => ({
      id: n.id,
      type: "wflow",
      position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      data: { nodeType: n.data.nodeType, config: n.data.config },
    })),
    edges: edges.map<FlowEdge>((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? "out" })),
  };
}

export function BuilderPage() {
  const { workflowId } = useParams();
  const org = useCurrentOrg();
  const workflow = useQuery({
    queryKey: orgKeys.scoped(org.id, "workflow", workflowId),
    queryFn: () => workflowsApi.get(org.id, workflowId!),
    // The canvas is the source of truth while editing; refreshes would fight with it.
    refetchOnWindowFocus: false,
  });
  const types = useNodeTypes(org.id);

  if (workflow.isLoading || types.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Opening workflow" />
      </div>
    );
  }
  if (workflow.error || types.error || !workflow.data || !types.data) {
    return <ErrorState message={errorMessage(workflow.error ?? types.error)} onRetry={() => void workflow.refetch()} />;
  }
  return (
    <ReactFlowProvider>
      <Builder key={workflow.data.id} initial={workflow.data} types={types.data} />
    </ReactFlowProvider>
  );
}

function Builder({ initial, types }: { initial: WorkflowDetail; types: Map<string, NodeType> }) {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const flow = useReactFlow();
  const lookups = useLookups(org.id);
  const canEdit = org.can("workflows.manage");
  const canPublish = org.can("workflows.publish");

  const [meta, setMeta] = useState(initial);
  const start = useMemo(() => toFlow(initial.definition), [initial]);
  const [nodes, setNodes, onNodesChange] = useNodesState<WflowNode>(start.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(start.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [testRun, setTestRun] = useState<RunDetail | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);

  // --- Undo / redo ------------------------------------------------------------------------
  const history = useRef<{ past: Snapshot[]; future: Snapshot[]; last: number }>({ past: [], future: [], last: 0 });
  const current = useRef<Snapshot>(start);
  current.current = { nodes, edges };
  const [, bump] = useState(0);
  const checkpoint = useCallback((coalesceMs = 0) => {
    const h = history.current;
    const now = Date.now();
    if (coalesceMs && now - h.last < coalesceMs) {
      h.last = now;
      return;
    }
    h.past = [...h.past.slice(-49), current.current];
    h.future = [];
    h.last = now;
    bump((n) => n + 1);
  }, []);
  const restore = useCallback(
    (from: "past" | "future") => {
      const h = history.current;
      const snap = h[from].at(-1);
      if (!snap) return;
      h[from] = h[from].slice(0, -1);
      h[from === "past" ? "future" : "past"].push(current.current);
      setNodes(snap.nodes);
      setEdges(snap.edges);
      bump((n) => n + 1);
    },
    [setNodes, setEdges],
  );

  // --- Autosave ---------------------------------------------------------------------------
  const definition = useMemo(() => toDefinition(nodes, edges), [nodes, edges]);
  const json = useMemo(() => JSON.stringify(definition), [definition]);
  const saved = useRef(JSON.stringify(toDefinition(start.nodes, start.edges)));
  const save = useMutation({
    mutationFn: (body: { json: string; definition: WorkflowDefinition }) =>
      workflowsApi.update(org.id, meta.id, { definition: body.definition }),
    onSuccess: async (wf, body) => {
      saved.current = body.json;
      setMeta((m) => ({ ...m, ...wf, definition: m.definition }));
      setValidation(await workflowsApi.validate(org.id, wf.id));
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });
    },
    onError: (err) => toast.error(`Couldn't save: ${errorMessage(err)}`),
  });
  const dirty = json !== saved.current;
  const flush = useCallback(async () => {
    if (canEdit && json !== saved.current) await save.mutateAsync({ json, definition });
  }, [canEdit, json, definition, save]);
  useEffect(() => {
    if (!canEdit || !dirty || save.isPending) return;
    const t = setTimeout(() => save.mutate({ json, definition }), 900);
    return () => clearTimeout(t);
  }, [json, dirty, canEdit, definition, save]);
  useEffect(() => {
    void workflowsApi.validate(org.id, meta.id).then(setValidation, () => undefined);
  }, [org.id, meta.id]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // --- Editing ----------------------------------------------------------------------------
  const hasTrigger = nodes.some((n) => types.get(n.data.nodeType)?.category === "trigger");

  const addStep = useCallback(
    (type: string, position?: { x: number; y: number }) => {
      const def = types.get(type);
      if (!def) return;
      if (def.category === "trigger" && hasTrigger) {
        toast.error("A workflow has one trigger. Delete the current trigger first to change it.");
        return;
      }
      checkpoint();
      const id = newId();
      const anchor = nodes.find((n) => n.id === selectedId);
      const pos =
        position ??
        (anchor
          ? { x: anchor.position.x + 300, y: anchor.position.y }
          : flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: "wflow", position: pos, data: { nodeType: type, config: defaultConfig(def) }, selected: true }]);
      // Clicking a step in the palette with a step selected connects it after that step.
      const handle = anchor && types.get(anchor.data.nodeType)?.outputs[0]?.handle;
      if (!position && anchor && handle && def.category !== "trigger") {
        setEdges((es) => addEdge({ id: `${anchor.id}-${handle}-${id}`, source: anchor.id, sourceHandle: handle, target: id, ...EDGE_STYLE }, es));
      }
      setSelectedId(id);
    },
    [types, hasTrigger, checkpoint, nodes, selectedId, flow, setNodes, setEdges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (c.source === c.target) return;
      checkpoint();
      const handle = c.sourceHandle ?? "out";
      setEdges((es) => addEdge({ ...c, id: `${c.source}-${handle}-${c.target}`, sourceHandle: handle, ...EDGE_STYLE }, es));
    },
    [checkpoint, setEdges],
  );

  const updateConfig = useCallback(
    (id: string, config: Record<string, unknown>) => {
      checkpoint(1200);
      setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, config } } : n)));
    },
    [checkpoint, setNodes],
  );

  const deleteNode = useCallback(
    (id: string) => {
      checkpoint();
      setNodes((ns) => ns.filter((n) => n.id !== id));
      setEdges((es) => es.filter((e) => e.source !== id && e.target !== id));
      setSelectedId(null);
    },
    [checkpoint, setNodes, setEdges],
  );

  const duplicateNode = useCallback(
    (id: string) => {
      const src = nodes.find((n) => n.id === id);
      if (!src) return;
      checkpoint();
      const copy: WflowNode = {
        id: newId(),
        type: "wflow",
        position: { x: src.position.x + 40, y: src.position.y + 120 },
        data: { nodeType: src.data.nodeType, config: structuredClone(src.data.config) },
        selected: true,
      };
      setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), copy]);
      setSelectedId(copy.id);
    },
    [nodes, checkpoint, setNodes],
  );

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DRAG_TYPE);
    if (type) addStep(type, flow.screenToFlowPosition({ x: e.clientX - 120, y: e.clientY - 30 }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        restore(e.shiftKey ? "future" : "past");
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        restore("future");
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restore, flush]);

  // --- Lifecycle actions ------------------------------------------------------------------
  const applyWorkflow = (wf: WorkflowDetail) => {
    setMeta(wf);
    queryClient.setQueryData(orgKeys.scoped(org.id, "workflow", wf.id), wf);
    void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });
  };

  const publish = useMutation({
    mutationFn: async () => {
      await flush();
      return workflowsApi.publish(org.id, meta.id);
    },
    onSuccess: ({ workflow, validation: v }) => {
      setValidation(v);
      if (!v.ok) {
        toast.error(`Fix ${v.errors.length === 1 ? "1 problem" : `${v.errors.length} problems`} before publishing`);
        setSelectedId(null);
        return;
      }
      applyWorkflow({ ...workflow, definition: meta.definition });
      toast.success(`Published version ${workflow.published_version} — the workflow is live`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const status = useMutation({
    mutationFn: (s: "active" | "paused" | "archived") => workflowsApi.setStatus(org.id, meta.id, s),
    onSuccess: (wf) => {
      applyWorkflow(wf);
      if (wf.status === "archived") navigate("/workflows");
      else toast.success(wf.status === "active" ? "Workflow activated" : "Workflow paused — no new runs will start");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const duplicate = useMutation({
    mutationFn: async () => {
      await flush();
      return workflowsApi.duplicate(org.id, meta.id);
    },
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });
      toast.success("Copy created");
      navigate(`/workflows/${wf.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const rename = useMutation({
    mutationFn: (data: { name?: string; description?: string | null }) => workflowsApi.update(org.id, meta.id, data),
    onSuccess: (wf) => applyWorkflow({ ...wf, definition: meta.definition }),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const onRestored = (wf: WorkflowDetail) => {
    checkpoint();
    const snap = toFlow(wf.definition);
    setNodes(snap.nodes);
    setEdges(snap.edges);
    saved.current = JSON.stringify(toDefinition(snap.nodes, snap.edges));
    applyWorkflow(wf);
    setSelectedId(null);
    void workflowsApi.validate(org.id, wf.id).then(setValidation);
    setTimeout(() => flow.fitView({ padding: 0.2 }), 50);
  };

  // --- Canvas info ------------------------------------------------------------------------
  const canvasInfo = useMemo<CanvasInfo>(() => {
    const issues = new Map<string, "error" | "warning">();
    for (const w of validation?.warnings ?? []) if (w.node_id) issues.set(w.node_id, "warning");
    for (const e of validation?.errors ?? []) if (e.node_id) issues.set(e.node_id, "error");
    return { types, lookups, issues, runNodes: new Map((testRun?.nodes ?? []).map((n) => [n.node_id, n])) };
  }, [types, lookups, validation, testRun]);

  const selected = nodes.find((n) => n.id === selectedId);
  const selectedDef = selected && types.get(selected.data.nodeType);
  const trigger = nodes.map((n) => types.get(n.data.nodeType)).find((d) => d?.category === "trigger");
  const st = WORKFLOW_STATUS[meta.status];

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-surface px-3">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/workflows" aria-label="Back to workflows">
            <ArrowLeft />
          </Link>
        </Button>
        <NameEditor name={meta.name} disabled={!canEdit} onSave={(name) => rename.mutate({ name })} />
        <Badge tone={st.tone}>{st.label}</Badge>
        {meta.published_version && (
          <span className="hidden text-xs text-muted sm:inline">
            v{meta.published_version}
            {meta.has_unpublished_changes && " · unpublished changes"}
          </span>
        )}
        <span className="ml-1 hidden text-xs text-subtle md:inline" aria-live="polite">
          {!canEdit ? "View only" : save.isPending ? "Saving…" : dirty ? "Unsaved" : "All changes saved"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {canEdit && (
            <>
              <Button variant="ghost" size="icon" onClick={() => restore("past")} disabled={!history.current.past.length} aria-label="Undo" title="Undo (Ctrl+Z)">
                <Undo2 />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => restore("future")} disabled={!history.current.future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
                <Redo2 />
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={() => setVersionsOpen(true)}>
            <History /> <span className="hidden lg:inline">Versions</span>
          </Button>
          {canEdit && (
            <Button
              variant="secondary"
              onClick={async () => {
                await flush();
                setTestOpen(true);
              }}
            >
              <FlaskConical /> Test
            </Button>
          )}
          {canPublish && (
            <Button onClick={() => publish.mutate()} loading={publish.isPending}>
              <Rocket /> {meta.published_version ? "Publish changes" : "Publish"}
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {canPublish && meta.published_version && meta.status !== "active" && (
                <DropdownMenuItem onSelect={() => status.mutate("active")}>
                  <Play /> Activate
                </DropdownMenuItem>
              )}
              {canPublish && meta.status === "active" && (
                <DropdownMenuItem onSelect={() => status.mutate("paused")}>
                  <Pause /> Pause
                </DropdownMenuItem>
              )}
              {canEdit && (
                <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                  <Copy /> Duplicate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <Link to={`/executions?workflow=${meta.id}`}>
                  <CheckCircle2 /> View runs
                </Link>
              </DropdownMenuItem>
              {canPublish && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-danger" onSelect={() => status.mutate("archived")}>
                    Archive
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {canEdit && <Palette types={types} hasTrigger={hasTrigger} onAdd={(t) => addStep(t)} />}
        <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => e.preventDefault()}>
          <CanvasContext.Provider value={canvasInfo}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeDragStart={() => checkpoint()}
              onBeforeDelete={async () => {
                checkpoint();
                return true;
              }}
              onSelectionChange={({ nodes: sel }) => setSelectedId(sel.length === 1 ? (sel[0]?.id ?? null) : null)}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              elementsSelectable
              deleteKeyCode={canEdit ? ["Backspace", "Delete"] : null}
              defaultEdgeOptions={EDGE_STYLE}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
              minZoom={0.2}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!hidden md:!block" />
            </ReactFlow>
          </CanvasContext.Provider>
          {nodes.length === 0 && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="rounded-lg border border-dashed bg-surface/90 px-6 py-5 text-center">
                <p className="text-sm font-medium">Start with a trigger</p>
                <p className="mt-1 max-w-xs text-xs text-muted">
                  {canEdit ? "Pick what starts this workflow from the Triggers list, then add steps after it." : "This workflow is empty."}
                </p>
              </div>
            </div>
          )}
        </div>
        <aside className="hidden w-80 shrink-0 border-l bg-surface lg:block" aria-label="Settings">
          {selected && selectedDef ? (
            <ConfigPanel
              key={selected.id}
              def={selectedDef}
              config={selected.data.config}
              issues={(validation?.errors ?? []).filter((i) => i.node_id === selected.id)}
              lookups={lookups}
              readOnly={!canEdit}
              onChange={(config) => updateConfig(selected.id, config)}
              onDelete={() => deleteNode(selected.id)}
              onDuplicate={() => duplicateNode(selected.id)}
              onClose={() => setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}
            />
          ) : (
            <WorkflowPanel
              workflow={meta}
              trigger={trigger}
              validation={validation}
              testRun={testRun}
              canEdit={canEdit}
              canPublish={canPublish}
              onSelectNode={(id) => {
                setNodes((ns) => ns.map((n) => ({ ...n, selected: n.id === id })));
                const n = nodes.find((x) => x.id === id);
                if (n) flow.setCenter(n.position.x + 120, n.position.y + 40, { zoom: 1, duration: 300 });
              }}
              onDescription={(description) => rename.mutate({ description })}
              onWorkflow={applyWorkflow}
              onClearTest={() => setTestRun(null)}
            />
          )}
        </aside>
      </div>
      <TestRunDialog
        open={testOpen}
        onOpenChange={setTestOpen}
        workflow={meta}
        trigger={trigger}
        onValidation={setValidation}
        onProgress={setTestRun}
      />
      <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} workflow={meta} canRestore={canEdit} onRestored={onRestored} />
    </div>
  );
}

function NameEditor({ name, disabled, onSave }: { name: string; disabled: boolean; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const commit = () => {
    const v = value.trim();
    if (v && v !== name) onSave(v);
    else setValue(name);
  };
  return (
    <input
      aria-label="Workflow name"
      className="h-8 w-40 min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm font-semibold hover:border-border focus-visible:border-primary focus-visible:outline-none sm:w-64"
      value={value}
      maxLength={120}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setValue(name);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function Palette({ types, hasTrigger, onAdd }: { types: Map<string, NodeType>; hasTrigger: boolean; onAdd: (type: string) => void }) {
  const [q, setQ] = useState("");
  const all = [...types.values()];
  const needle = q.trim().toLowerCase();
  const visible = needle ? all.filter((t) => `${t.label} ${t.description}`.toLowerCase().includes(needle)) : all;
  // Until the workflow has a trigger, that's the only thing worth picking.
  const order = hasTrigger ? [...CATEGORY_ORDER.slice(1), "trigger" as const] : CATEGORY_ORDER;

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r bg-surface md:flex" aria-label="Steps">
      <div className="border-b p-2.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 size-4 text-subtle" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a step" className="pl-7" aria-label="Find a step" />
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-2.5">
        {order.map((cat) => {
          const items = visible.filter((t) => t.category === cat);
          if (!items.length) return null;
          const meta = CATEGORIES[cat];
          const disabled = cat === "trigger" && hasTrigger;
          return (
            <section key={cat}>
              <h3 className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted">{meta.label}</h3>
              <ul className="space-y-0.5">
                {items.map((t) => (
                  <li key={t.type}>
                    <button
                      type="button"
                      draggable={!disabled}
                      disabled={disabled}
                      title={disabled ? "This workflow already has a trigger" : `${t.description} — click or drag onto the canvas`}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DRAG_TYPE, t.type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onClick={() => onAdd(t.type)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-[13px] hover:bg-surface-muted disabled:opacity-45",
                        !disabled && "cursor-grab active:cursor-grabbing",
                      )}
                    >
                      <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-sm", meta.accent)}>
                        <meta.icon className="size-3" aria-hidden />
                      </span>
                      <span className="truncate">{t.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </aside>
  );
}
