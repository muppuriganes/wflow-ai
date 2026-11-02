import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calendar, MoreHorizontal, Pause, Play, Plus, RefreshCw, Trash2, Workflow } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/services/api";
import { schedulesApi } from "@/services/schedules";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { Schedule } from "@/types/api";
import { formatRelative } from "@/utils/format";
import { CreateScheduleDialog } from "./CreateScheduleDialog";

function formatTiming(s: Schedule): string {
  const cfg = s.config || {};
  switch (s.schedule_type) {
    case "daily":
      return `Daily at ${cfg.time || "09:00"}`;
    case "weekly": {
      const days = (cfg.days as string[] | undefined)?.map((d) => d.toUpperCase()).join(", ") || "Mon-Fri";
      return `Weekly on ${days} at ${cfg.time || "09:00"}`;
    }
    case "monthly":
      return `Monthly on day ${cfg.day_of_month || 1} at ${cfg.time || "09:00"}`;
    case "once":
      return `Once on ${cfg.date || "scheduled date"} at ${cfg.time || "09:00"}`;
    case "cron":
      return `Cron: ${cfg.cron || "* * * * *"}`;
    default:
      return s.schedule_type;
  }
}

export function SchedulesPage() {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);

  const list = useQuery({
    queryKey: orgKeys.scoped(org.id, "schedules"),
    queryFn: () => schedulesApi.list(org.id),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "schedules") });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.pause(org.id, id),
    onSuccess: (s) => {
      refresh();
      toast.success(`Schedule “${s.name}” paused`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.resume(org.id, id),
    onSuccess: (s) => {
      refresh();
      toast.success(`Schedule “${s.name}” resumed`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const triggerMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.trigger(org.id, id),
    onSuccess: () => {
      refresh();
      toast.success("Schedule triggered successfully");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => schedulesApi.delete(org.id, id),
    onSuccess: () => {
      refresh();
      toast.success("Schedule deleted");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const canManage = org.can("workflows.manage");

  return (
    <>
      <PageHeader
        title="Schedules"
        description="Automated schedules that trigger workflows daily, weekly, on specific dates or via cron expressions."
        actions={
          canManage && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New schedule
            </Button>
          )
        }
      />

      <Card>
        {list.isLoading ? (
          <LoadingRows rows={4} />
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        ) : !list.data?.length ? (
          <EmptyState
            icon={Calendar}
            title="No schedules yet"
            description="Create recurring or one-off schedules to run automated workflows in your organization's timezone."
            action={
              canManage && (
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus /> Create your first schedule
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
                <TH>Workflow</TH>
                <TH className="hidden md:table-cell">Frequency</TH>
                <TH className="hidden lg:table-cell">Target Tag</TH>
                <TH className="hidden lg:table-cell">Next Run</TH>
                <TH className="hidden xl:table-cell">Last Run</TH>
                <TH className="hidden xl:table-cell">Runs</TH>
                <TH className="w-10">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {list.data.map((schedule) => {
                const isActive = schedule.status === "active";
                return (
                  <TR key={schedule.id} className="hover:bg-surface-muted/50">
                    <TD>
                      <div className="font-medium text-foreground">{schedule.name}</div>
                      {schedule.description && (
                        <p className="max-w-xs truncate text-xs text-muted">{schedule.description}</p>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={isActive ? "success" : "neutral"} className="gap-1.5">
                        <StatusDot tone={isActive ? "success" : "neutral"} label={schedule.status} />
                        <span className="capitalize">{schedule.status}</span>
                      </Badge>
                    </TD>
                    <TD>
                      <Link
                        to={`/workflows/${schedule.workflow_id}`}
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                      >
                        <Workflow className="h-3.5 w-3.5" />
                        <span className="max-w-[160px] truncate">{schedule.workflow_name || "Workflow"}</span>
                      </Link>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <span className="text-xs text-foreground font-mono">{formatTiming(schedule)}</span>
                      <div className="text-[10px] text-muted">{schedule.timezone}</div>
                    </TD>
                    <TD className="hidden lg:table-cell">
                      {schedule.target_tag_name ? (
                        <Badge tone="neutral" className="text-xs">
                          {schedule.target_tag_name}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </TD>
                    <TD className="hidden lg:table-cell text-xs text-muted">
                      {schedule.next_run_at ? formatRelative(schedule.next_run_at) : "—"}
                    </TD>
                    <TD className="hidden xl:table-cell text-xs text-muted">
                      {schedule.last_run_at ? formatRelative(schedule.last_run_at) : "Never"}
                    </TD>
                    <TD className="hidden xl:table-cell text-xs font-mono">{schedule.total_runs}</TD>
                    <TD>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Schedule actions">
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {isActive ? (
                              <DropdownMenuItem onClick={() => pauseMutation.mutate(schedule.id)}>
                                <Pause /> Pause schedule
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => resumeMutation.mutate(schedule.id)}>
                                <Play /> Resume schedule
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => triggerMutation.mutate(schedule.id)}>
                              <RefreshCw /> Run now
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-danger focus:text-danger"
                              onClick={() => {
                                if (window.confirm(`Delete schedule "${schedule.name}"?`)) {
                                  deleteMutation.mutate(schedule.id);
                                }
                              }}
                            >
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </Card>

      <CreateScheduleDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
export default SchedulesPage;
