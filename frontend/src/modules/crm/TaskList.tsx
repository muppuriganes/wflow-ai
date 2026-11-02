import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, ListTodo, Trash2 } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { useCurrentOrg } from "@/stores/organization";
import type { Task } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime } from "@/utils/format";

function dueLabel(task: Task): { text: string; tone: string } | null {
  if (!task.due_at) return null;
  const due = new Date(task.due_at);
  const now = new Date();
  const sameDay = due.toDateString() === now.toDateString();
  if (!task.completed_at && due < now) return { text: `Overdue · ${formatDateTime(task.due_at)}`, tone: "text-danger" };
  if (sameDay) return { text: `Today · ${due.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`, tone: "text-warning" };
  return { text: formatDateTime(task.due_at), tone: "text-muted" };
}

export function TaskList({ tasks, emptyText = "No tasks" }: { tasks: Task[]; emptyText?: string }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const canManage = org.can("contacts.manage");
  const refresh = () => {
    for (const k of ["tasks", "contact", "leads"]) void queryClient.invalidateQueries({ queryKey: ["org", org.id, k] });
  };
  const toggle = useMutation({
    mutationFn: (t: Task) => crmApi.updateTask(org.id, t.id, { completed: !t.completed_at }),
    onSuccess: refresh,
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (t: Task) => crmApi.deleteTask(org.id, t.id),
    onSuccess: () => {
      toast.success("Task deleted");
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!tasks.length) return <EmptyState icon={ListTodo} title={emptyText} className="py-8" />;
  return (
    <ul className="divide-y">
      {tasks.map((t) => {
        const due = dueLabel(t);
        return (
          <li key={t.id} className="flex items-start gap-3 px-4 py-2.5">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--color-primary)]"
              checked={Boolean(t.completed_at)}
              disabled={!canManage || toggle.isPending}
              onChange={() => toggle.mutate(t)}
              aria-label={t.completed_at ? `Reopen ${t.title}` : `Complete ${t.title}`}
            />
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", t.completed_at && "text-muted line-through")}>{t.title}</p>
              {t.description && <p className="mt-0.5 whitespace-pre-wrap text-xs text-muted">{t.description}</p>}
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                {due && (
                  <span className={cn("inline-flex items-center gap-1", t.completed_at ? "text-muted" : due.tone)}>
                    <CalendarClock className="size-3.5" aria-hidden />
                    {due.text}
                  </span>
                )}
                {t.assignee && <span className="text-muted">{t.assignee.full_name}</span>}
                {t.contact && (
                  <Link to={`/contacts/${t.contact.id}`} className="text-primary hover:underline">
                    {t.contact.label}
                  </Link>
                )}
                {t.lead && <span className="text-muted">Lead: {t.lead.label}</span>}
                {t.conversation_id && (
                  <Link to={`/inbox/${t.conversation_id}?view=all`} className="text-primary hover:underline">
                    Conversation
                  </Link>
                )}
              </p>
            </div>
            {canManage && (
              <Tooltip content="Delete task">
                <Button variant="ghost" size="icon" aria-label={`Delete ${t.title}`} onClick={() => remove.mutate(t)}>
                  <Trash2 />
                </Button>
              </Tooltip>
            )}
          </li>
        );
      })}
    </ul>
  );
}
