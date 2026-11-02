import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { errorMessage } from "@/services/api";
import { inboxApi } from "@/services/inbox";
import { schedulesApi } from "@/services/schedules";
import { workflowsApi } from "@/services/workflows";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { ScheduleType, Tag } from "@/types/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const DAY_OPTIONS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
];

export function CreateScheduleDialog({ open, onOpenChange }: Props) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();

  const [workflowId, setWorkflowId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState<ScheduleType>("daily");
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState<string[]>(["mon", "tue", "wed", "thu", "fri"]);
  const [dayOfMonth, setDayOfMonth] = useState("1");
  const [date, setDate] = useState("");
  const [cronExpression, setCronExpression] = useState("0 9 * * 1-5");
  const [targetTagId, setTargetTagId] = useState("");

  const workflows = useQuery({
    queryKey: orgKeys.scoped(org.id, "workflows"),
    queryFn: () => workflowsApi.list(org.id),
    enabled: open,
  });

  // The server only accepts published workflows whose trigger is "On a schedule".
  const schedulable = (workflows.data ?? []).filter((w) => w.trigger_type === "trigger.schedule" && w.published_version);

  const tags = useQuery({
    queryKey: orgKeys.scoped(org.id, "tags"),
    queryFn: () => inboxApi.tags(org.id),
    enabled: open,
  });

  const create = useMutation({
    mutationFn: () => {
      const config: Record<string, unknown> = { time };
      if (frequency === "weekly") {
        config.days = selectedDays;
      } else if (frequency === "monthly") {
        config.day_of_month = parseInt(dayOfMonth, 10) || 1;
      } else if (frequency === "cron") {
        config.cron_expression = cronExpression;
      } else if (frequency === "once") {
        config.date = date;
      }

      return schedulesApi.create(org.id, {
        workflow_id: workflowId,
        name: name.trim(),
        description: description.trim() || null,
        schedule_type: frequency,
        config,
        target_tag_id: targetTagId || null,
      });
    },
    onSuccess: () => {
      toast.success("Schedule created successfully");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "schedules") });
      onOpenChange(false);
      reset();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const reset = () => {
    setWorkflowId("");
    setName("");
    setDescription("");
    setFrequency("daily");
    setTime("09:00");
    setSelectedDays(["mon", "tue", "wed", "thu", "fri"]);
    setDayOfMonth("1");
    setDate("");
    setCronExpression("0 9 * * 1-5");
    setTargetTagId("");
  };

  const handleWorkflowChange = (id: string) => {
    setWorkflowId(id);
    if (!name) {
      const wf = workflows.data?.find((w) => w.id === id);
      if (wf) setName(`${wf.name} Schedule`);
    }
  };

  const toggleDay = (d: string) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create schedule"
      description={`Configured in organization timezone (${org.timezone || "UTC"}).`}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={create.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={!workflowId || !name.trim() || create.isPending}
          >
            {create.isPending ? "Creating..." : "Create schedule"}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field
          label="Workflow"
          hint={
            workflows.data && !schedulable.length ? (
              <>
                No workflow can be scheduled yet. Build one that starts with “On a schedule” and publish it in{" "}
                <Link to="/workflows" className="text-primary hover:underline" onClick={() => onOpenChange(false)}>
                  Workflows
                </Link>
                .
              </>
            ) : (
              "Published workflows that start “On a schedule”."
            )
          }
        >
          <NativeSelect value={workflowId} onChange={(e) => handleWorkflowChange(e.target.value)}>
            <option value="">Select a workflow...</option>
            {schedulable.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
                {w.status !== "active" ? ` (${w.status})` : ""}
              </option>
            ))}
          </NativeSelect>
        </Field>

        <Field label="Schedule name">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Daily Customer Check-in"
          />
        </Field>

        <Field label="Description (optional)">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="e.g. Send reminders to active clients"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Frequency">
            <NativeSelect
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as ScheduleType)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="cron">Custom cron</option>
              <option value="once">One-off</option>
            </NativeSelect>
          </Field>

          {frequency !== "cron" && (
            <Field label="Time of day">
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          )}
        </div>

        {frequency === "weekly" && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Days of week</label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_OPTIONS.map((opt) => {
                const active = selectedDays.includes(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleDay(opt.value)}
                    className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-surface text-muted hover:bg-surface-muted"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {frequency === "monthly" && (
          <Field label="Day of month (1-31)">
            <Input
              type="number"
              min={1}
              max={31}
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
            />
          </Field>
        )}

        {frequency === "once" && (
          <Field label="Date (YYYY-MM-DD)">
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              placeholder="YYYY-MM-DD"
            />
          </Field>
        )}

        {frequency === "cron" && (
          <Field label="Cron expression" hint="Format: minute hour day-of-month month day-of-week">
            <Input
              value={cronExpression}
              onChange={(e) => setCronExpression(e.target.value)}
              placeholder="0 9 * * 1-5"
            />
          </Field>
        )}

        <Field
          label="Target contact tag (optional)"
          hint="If selected, this schedule starts a workflow run for every contact with this tag."
        >
          <NativeSelect value={targetTagId} onChange={(e) => setTargetTagId(e.target.value)}>
            <option value="">None (single workflow execution)</option>
            {tags.data?.map((t: Tag) => (
              <option key={t.id} value={t.id}>
                Run for contacts tagged: {t.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
    </Dialog>
  );
}
