import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { crmApi, type LeadInput } from "@/services/crm";
import { useCurrentOrg } from "@/stores/organization";
import type { Lead, LeadStage } from "@/types/api";
import { ContactPicker, MemberSelect, STAGES } from "./shared";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead?: Lead | null;
  contact?: { id: string; name: string } | null;
  defaultStage?: LeadStage;
  defaultSource?: string;
};

export function LeadDialog({ open, onOpenChange, lead, contact, defaultStage = "NEW", defaultSource }: Props) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const editing = Boolean(lead);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState({
    title: "", stage: defaultStage as LeadStage, value_amount: "", currency: "INR", source: defaultSource ?? "",
    score: "0", owner_user_id: null as string | null, expected_close_date: "", lost_reason: "",
  });  // prettier-ignore
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setPicked(lead ? { id: lead.contact.id, name: lead.contact.display_name ?? "Contact" } : contact ?? null);
    setForm({
      title: lead?.title ?? "",
      stage: lead?.stage ?? defaultStage,
      value_amount: lead?.value_amount ?? "",
      currency: lead?.currency ?? "INR",
      source: lead?.source ?? defaultSource ?? "",
      score: String(lead?.score ?? 0),
      owner_user_id: lead?.owner?.id ?? null,
      expected_close_date: lead?.expected_close_date ?? "",
      lost_reason: lead?.lost_reason ?? "",
    });
  }, [open, lead, contact, defaultStage, defaultSource]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!picked) return setError("Choose a contact");
    if (!form.title.trim()) return setError("Give the lead a title");
    setSaving(true);
    setError(null);
    const body: LeadInput = {
      title: form.title.trim(),
      stage: form.stage,
      value_amount: form.value_amount === "" ? null : form.value_amount,
      currency: form.currency,
      source: form.source.trim() || null,
      score: Math.max(0, Math.min(100, Number(form.score) || 0)),
      owner_user_id: form.owner_user_id,
      expected_close_date: form.expected_close_date || null,
      ...(form.stage === "LOST" ? { lost_reason: form.lost_reason.trim() || null } : {}),
    };
    try {
      if (lead) await crmApi.updateLead(org.id, lead.id, body);
      else await crmApi.createLead(org.id, { ...body, contact_id: picked.id });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "leads"] });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "contact"] });
      toast.success(editing ? "Lead updated" : "Lead created");
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
      size="md"
      title={editing ? "Edit lead" : "New lead"}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="lead-form" loading={saving}>
            {editing ? "Save changes" : "Create lead"}
          </Button>
        </>
      }
    >
      <form id="lead-form" onSubmit={onSubmit} noValidate className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">{error}</Alert>
          </div>
        )}
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-xs font-medium">Contact</p>
          {editing ? (
            <p className="text-[13px]">{picked?.name}</p>
          ) : (
            <ContactPicker value={picked} onChange={setPicked} />
          )}
        </div>
        <Field label="Title" className="sm:col-span-2">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. 200 kurtas for Diwali" />
        </Field>
        <Field label="Stage">
          <NativeSelect value={form.stage} onChange={(e) => set("stage", e.target.value as LeadStage)}>
            {STAGES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Owner">
          <MemberSelect value={form.owner_user_id} onChange={(v) => set("owner_user_id", v)} />
        </Field>
        <Field label="Value">
          <Input type="number" min={0} step="0.01" value={form.value_amount} onChange={(e) => set("value_amount", e.target.value)} />
        </Field>
        <Field label="Currency">
          <NativeSelect value={form.currency} onChange={(e) => set("currency", e.target.value)}>
            {["INR", "USD", "EUR", "GBP", "AED", "SGD"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Score (0–100)" hint="How likely this is to convert.">
          <Input type="number" min={0} max={100} value={form.score} onChange={(e) => set("score", e.target.value)} />
        </Field>
        <Field label="Expected close">
          <Input type="date" value={form.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} />
        </Field>
        <Field label="Source" className="sm:col-span-2">
          <Input value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="whatsapp, referral, website…" />
        </Field>
        {form.stage === "LOST" && (
          <Field label="Why was it lost?" className="sm:col-span-2">
            <Input value={form.lost_reason} onChange={(e) => set("lost_reason", e.target.value)} placeholder="Price, timing, competitor…" />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
