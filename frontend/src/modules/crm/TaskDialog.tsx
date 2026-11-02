import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { useAuth } from "@/stores/auth";
import { errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { useCurrentOrg } from "@/stores/organization";
import { fromLocalInput, MemberSelect } from "./shared";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional links shown as context ("Follow up with Ravi"). */
  link?: { contact_id?: string; lead_id?: string; conversation_id?: string; label?: string };
};

function tomorrowAt10(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T10:00`;
}

export function TaskDialog({ open, onOpenChange, link }: Props) {
  const org = useCurrentOrg();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [due, setDue] = useState(tomorrowAt10());
  const [assignee, setAssignee] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(link?.label ? `Follow up with ${link.label}` : "");
    setDescription("");
    setDue(tomorrowAt10());
    setAssignee(user?.id ?? null);
    setError(null);
  }, [open, link?.label, user?.id]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Enter a title");
    setSaving(true);
    try {
      await crmApi.createTask(org.id, {
        title: title.trim(),
        description: description.trim() || null,
        due_at: fromLocalInput(due),
        assignee_user_id: assignee,
        contact_id: link?.contact_id ?? null,
        lead_id: link?.lead_id ?? null,
        conversation_id: link?.conversation_id ?? null,
      });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "contact"] });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "leads"] });
      toast.success("Task created");
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New follow-up task"
      description={link?.label ? `Linked to ${link.label}` : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="task-form" loading={saving}>
            Create task
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={onSubmit} noValidate className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <Field label="Title">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due" hint="In your local time.">
            <Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Assignee">
            <MemberSelect value={assignee} onChange={setAssignee} />
          </Field>
        </div>
        <Field label="Details (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15"
          />
        </Field>
      </form>
    </Dialog>
  );
}
