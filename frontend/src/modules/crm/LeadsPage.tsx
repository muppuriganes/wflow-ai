import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ListTodo, Plus, Search, Target } from "lucide-react";
import { type DragEvent, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { useDebounced } from "@/hooks/useDebounced";
import { errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Lead, LeadStage } from "@/types/api";
import { cn } from "@/utils/cn";
import { CrmTabs } from "./CrmTabs";
import { LeadDialog } from "./LeadDialog";
import { formatMoney, STAGES } from "./shared";

function LeadCard({ lead, draggable, onOpen }: { lead: Lead; draggable: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/lead-id", lead.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      className={cn(
        "w-full rounded-md border bg-surface p-2.5 text-left shadow-card hover:border-primary/40",
        draggable && "cursor-grab active:cursor-grabbing",
      )}
    >
      <p className="line-clamp-2 text-[13px] font-medium">{lead.title}</p>
      <p className="mt-0.5 truncate text-xs text-muted">{lead.contact.display_name ?? "Contact"}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">{formatMoney(lead.value_amount, lead.currency)}</span>
        <span className="flex items-center gap-2 text-muted">
          {lead.open_tasks > 0 && (
            <span className="inline-flex items-center gap-0.5" title={`${lead.open_tasks} open task(s)`}>
              <ListTodo className="size-3.5" aria-hidden />
              {lead.open_tasks}
            </span>
          )}
          {lead.expected_close_date && (
            <span className="inline-flex items-center gap-0.5" title="Expected close">
              <CalendarClock className="size-3.5" aria-hidden />
              {new Date(`${lead.expected_close_date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
            </span>
          )}
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-muted">{lead.owner?.full_name ?? "No owner"}</span>
        <span className="h-1.5 w-12 overflow-hidden rounded-full bg-surface-muted" title={`Score ${lead.score}/100`}>
          <span className="block h-full rounded-full bg-primary" style={{ width: `${lead.score}%` }} />
        </span>
      </div>
    </button>
  );
}

export function LeadsPage() {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [owner, setOwner] = useState<"" | "me" | "unassigned">("");
  const [dialog, setDialog] = useState<{ open: boolean; lead: Lead | null; stage?: LeadStage }>({ open: false, lead: null });
  const [dropTarget, setDropTarget] = useState<LeadStage | null>(null);
  const key = orgKeys.scoped(org.id, "leads", "board", q, owner);
  const board = useQuery({ queryKey: key, queryFn: () => crmApi.leads(org.id, { q: q || undefined, owner: owner || undefined }) });
  const canManage = org.can("leads.manage");

  const move = useMutation({
    mutationFn: ({ lead, stage }: { lead: Lead; stage: LeadStage }) => crmApi.updateLead(org.id, lead.id, { stage }),
    onMutate: async ({ lead, stage }) => {
      // Optimistic move so dragging feels instant; rolled back on error.
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<typeof board.data>(key);
      queryClient.setQueryData<typeof board.data>(key, (old) =>
        old ? { ...old, items: old.items.map((l) => (l.id === lead.id ? { ...l, stage } : l)) } : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      queryClient.setQueryData(key, context?.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ["org", org.id, "leads"] }),
  });

  const onDrop = (stage: LeadStage) => (e: DragEvent) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData("text/lead-id");
    const lead = board.data?.items.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    if (stage === "LOST") {
      setDialog({ open: true, lead: { ...lead, stage: "LOST" } }); // ask for the reason
      return;
    }
    move.mutate({ lead, stage });
  };

  const openStages = STAGES.filter((s) => s.key !== "CONVERTED" && s.key !== "LOST");
  const pipelineValue = board.data?.stages.filter((s) => openStages.some((o) => o.key === s.stage)).reduce((sum, s) => sum + Number(s.total_value), 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Contacts & CRM"
        description={board.data ? `Open pipeline: ${formatMoney(pipelineValue)}` : "Your sales pipeline"}
        actions={
          canManage && (
            <Button onClick={() => setDialog({ open: true, lead: null })}>
              <Plus /> New lead
            </Button>
          )
        }
      />
      <CrmTabs />
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" aria-hidden />
          <Input className="pl-8" placeholder="Search leads or contacts" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" />
        </div>
        <NativeSelect className="w-44" aria-label="Owner" value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)}>
          <option value="">All owners</option>
          <option value="me">My leads</option>
          <option value="unassigned">No owner</option>
        </NativeSelect>
      </div>
      {board.isLoading ? (
        <Card>
          <LoadingRows rows={5} />
        </Card>
      ) : board.error ? (
        <ErrorState message={errorMessage(board.error)} onRetry={() => void board.refetch()} />
      ) : !board.data?.items.length && !q && !owner ? (
        <Card>
          <EmptyState
            icon={Target}
            title="No leads yet"
            description="Create a lead from a conversation or a contact, then move it through the stages as the deal progresses."
            action={canManage && <Button onClick={() => setDialog({ open: true, lead: null })}><Plus /> New lead</Button>}
          />
        </Card>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4 pb-2 lg:-mx-6 lg:px-6">
          <div className="flex min-w-max gap-3">
            {STAGES.map((stage) => {
              const items = board.data!.items.filter((l) => l.stage === stage.key);
              const summary = board.data!.stages.find((s) => s.stage === stage.key);
              return (
                <section
                  key={stage.key}
                  aria-label={`${stage.label} stage`}
                  onDragOver={(e) => {
                    if (!canManage) return;
                    e.preventDefault();
                    setDropTarget(stage.key);
                  }}
                  onDragLeave={() => setDropTarget((t) => (t === stage.key ? null : t))}
                  onDrop={onDrop(stage.key)}
                  className={cn(
                    "flex w-64 shrink-0 flex-col rounded-lg border bg-surface-muted/60 p-2",
                    dropTarget === stage.key && "border-primary bg-primary-soft/60",
                  )}
                >
                  <header className="mb-2 flex items-baseline justify-between px-1">
                    <h2 className="text-xs font-semibold uppercase tracking-wide text-muted">
                      {stage.label} <span className="font-normal">· {summary?.count ?? 0}</span>
                    </h2>
                    <span className="text-[11px] text-muted">{formatMoney(summary?.total_value ?? 0)}</span>
                  </header>
                  <div className="flex min-h-24 flex-col gap-2">
                    {items.map((lead) => (
                      <LeadCard key={lead.id} lead={lead} draggable={canManage} onOpen={() => setDialog({ open: true, lead })} />
                    ))}
                    {!items.length && <p className="px-1 py-4 text-center text-[11px] text-subtle">{canManage ? "Drop leads here" : "Empty"}</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      <LeadDialog open={dialog.open} onOpenChange={(open) => setDialog((d) => ({ ...d, open }))} lead={dialog.lead} />
    </>
  );
}
