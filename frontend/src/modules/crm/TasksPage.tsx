import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorState, LoadingRows } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { crmApi, type TaskFilters } from "@/services/crm";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import { cn } from "@/utils/cn";
import { CrmTabs } from "./CrmTabs";
import { TaskDialog } from "./TaskDialog";
import { TaskList } from "./TaskList";

const FILTERS: { key: string; label: string; filters: Omit<TaskFilters, "scope"> }[] = [
  { key: "open", label: "All open", filters: { status: "open" } },
  { key: "overdue", label: "Overdue", filters: { status: "open", due: "overdue" } },
  { key: "today", label: "Due today", filters: { status: "open", due: "today" } },
  { key: "upcoming", label: "Upcoming", filters: { status: "open", due: "upcoming" } },
  { key: "done", label: "Completed", filters: { status: "done" } },
];

export function TasksPage() {
  const org = useCurrentOrg();
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [filter, setFilter] = useState("open");
  const [createOpen, setCreateOpen] = useState(false);
  const selected = FILTERS.find((f) => f.key === filter)!;
  const tasks = useQuery({
    queryKey: orgKeys.scoped(org.id, "tasks", scope, filter),
    queryFn: () => crmApi.tasks(org.id, { scope, ...selected.filters }),
  });

  return (
    <>
      <PageHeader
        title="Contacts & CRM"
        description="Follow-ups for your team, shown in your local time."
        actions={
          org.can("contacts.manage") && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New task
            </Button>
          )
        }
      />
      <CrmTabs />
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Task filter">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "h-7 rounded-md px-2.5 text-xs font-medium text-muted hover:bg-surface-muted",
                  filter === f.key && "bg-primary-soft text-primary hover:bg-primary-soft",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Whose tasks">
            {(["mine", "all"] as const).map((s) => (
              <button
                key={s}
                aria-pressed={scope === s}
                onClick={() => setScope(s)}
                className={cn("h-6 rounded-sm px-2.5 font-medium text-muted", scope === s && "bg-surface-muted text-foreground")}
              >
                {s === "mine" ? "Mine" : "Everyone"}
              </button>
            ))}
          </div>
        </div>
        {tasks.isLoading ? (
          <LoadingRows rows={4} />
        ) : tasks.error ? (
          <ErrorState message={errorMessage(tasks.error)} onRetry={() => void tasks.refetch()} />
        ) : (
          <TaskList tasks={tasks.data ?? []} emptyText={filter === "overdue" ? "Nothing overdue — nice." : "No tasks here"} />
        )}
      </Card>
      <TaskDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
