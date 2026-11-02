import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Plus, Workflow } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/services/api";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { WorkflowSummary } from "@/types/api";
import { formatRelative } from "@/utils/format";
import { RUN_STATUS, useNodeTypes, WORKFLOW_STATUS } from "./meta";

export function WorkflowsPage() {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const types = useNodeTypes(org.id);
  const list = useQuery({
    queryKey: orgKeys.scoped(org.id, "workflows", showArchived),
    queryFn: () => workflowsApi.list(org.id, showArchived),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });

  const status = useMutation({
    mutationFn: ({ id, s }: { id: string; s: "active" | "paused" | "archived" }) => workflowsApi.setStatus(org.id, id, s),
    onSuccess: (wf) => {
      refresh();
      toast.success(`“${wf.name}” is now ${WORKFLOW_STATUS[wf.status].label.toLowerCase()}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const duplicate = useMutation({
    mutationFn: (id: string) => workflowsApi.duplicate(org.id, id),
    onSuccess: (wf) => {
      refresh();
      navigate(`/workflows/${wf.id}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const triggerLabel = (wf: WorkflowSummary) => (wf.trigger_type ? (types.data?.get(wf.trigger_type)?.label ?? wf.trigger_type) : "—");
  const canEdit = org.can("workflows.manage");
  const canPublish = org.can("workflows.publish");

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Automations that react to WhatsApp messages, new contacts, webhooks or a button press."
        actions={
          canEdit && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New workflow
            </Button>
          )
        }
      />
      <Card>
        <div className="flex items-center justify-end border-b px-3 py-2">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        </div>
        {list.isLoading ? (
          <LoadingRows rows={4} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={Workflow}
            title="No workflows yet"
            description="Reply to keywords automatically, tag and assign new chats, create leads, wait for replies or ask a manager to approve."
            action={
              canEdit && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create your first workflow
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Status</TH>
                <TH className="hidden md:table-cell">Starts when</TH>
                <TH className="hidden lg:table-cell">Runs (7 days)</TH>
                <TH className="hidden lg:table-cell">Last run</TH>
                <TH className="w-10">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.data.map((wf) => {
                const st = WORKFLOW_STATUS[wf.status];
                return (
                  <TR key={wf.id} className="hover:bg-surface-muted/50">
                    <TD>
                      <Link to={`/workflows/${wf.id}`} className="font-medium hover:underline">
                        {wf.name}
                      </Link>
                      {wf.description && <p className="max-w-md truncate text-xs text-muted">{wf.description}</p>}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {wf.published_version && <span className="text-xs text-muted">v{wf.published_version}</span>}
                        {wf.has_unpublished_changes && wf.published_version && (
                          <span className="text-xs text-warning" title="The draft differs from the live version">
                            edited
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD className="hidden text-muted md:table-cell">{triggerLabel(wf)}</TD>
                    <TD className="hidden lg:table-cell">
                      <Link to={`/executions?workflow=${wf.id}`} className="hover:underline">
                        {wf.stats.total_7d}
                      </Link>
                      {wf.stats.failed_7d > 0 && <span className="ml-1.5 text-xs text-danger">{wf.stats.failed_7d} failed</span>}
                    </TD>
                    <TD className="hidden lg:table-cell">
                      {wf.stats.last_status && wf.stats.last_run_at ? (
                        <span className="inline-flex items-center gap-2">
                          <StatusDot tone={RUN_STATUS[wf.stats.last_status].tone} label={RUN_STATUS[wf.stats.last_status].label} />
                          <span className="text-xs text-muted">{formatRelative(wf.stats.last_run_at)}</span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">Never</span>
                      )}
                    </TD>
                    <TD>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${wf.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem asChild>
                            <Link to={`/workflows/${wf.id}`}>{canEdit ? "Edit" : "Open"}</Link>
                          </DropdownMenuItem>
                          {canPublish && wf.published_version && wf.status !== "active" && (
                            <DropdownMenuItem onSelect={() => status.mutate({ id: wf.id, s: "active" })}>Activate</DropdownMenuItem>
                          )}
                          {canPublish && wf.status === "active" && (
                            <DropdownMenuItem onSelect={() => status.mutate({ id: wf.id, s: "paused" })}>Pause</DropdownMenuItem>
                          )}
                          {canEdit && <DropdownMenuItem onSelect={() => duplicate.mutate(wf.id)}>Duplicate</DropdownMenuItem>}
                          {canPublish && wf.status !== "archived" && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-danger" onSelect={() => status.mutate({ id: wf.id, s: "archived" })}>
                                Archive
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>
      <CreateWorkflowDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function CreateWorkflowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => workflowsApi.create(org.id, { name: name.trim() }),
    onSuccess: (wf) => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "workflows") });
      onOpenChange(false);
      setName("");
      navigate(`/workflows/${wf.id}`);
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New workflow"
      description="Give it a name; you'll design the steps next."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="new-workflow" loading={create.isPending} disabled={!name.trim()}>
            Create
          </Button>
        </>
      }
    >
      <form
        id="new-workflow"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <Field label="Name" error={create.error ? errorMessage(create.error) : undefined}>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="e.g. Price enquiries" autoFocus />
        </Field>
      </form>
    </Dialog>
  );
}
