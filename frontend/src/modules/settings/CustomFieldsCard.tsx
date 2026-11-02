import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, SlidersHorizontal } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { CustomField, CustomFieldType } from "@/types/api";

const TYPES: { key: CustomFieldType; label: string }[] = [
  { key: "text", label: "Text" },
  { key: "number", label: "Number" },
  { key: "date", label: "Date" },
  { key: "select", label: "List of options" },
  { key: "boolean", label: "Yes / No" },
];

function toKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "f_$1").slice(0, 50);
}

function NewFieldDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [entity, setEntity] = useState<"contact" | "lead">("contact");
  const [label, setLabel] = useState("");
  const [type, setType] = useState<CustomFieldType>("text");
  const [options, setOptions] = useState("");
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      crmApi.createCustomField(org.id, {
        entity,
        key: toKey(label),
        label: label.trim(),
        field_type: type,
        options: type === "select" ? options.split(",").map((o) => o.trim()).filter(Boolean) : [],
        required,
      }),
    onSuccess: () => {
      toast.success("Field added");
      void queryClient.invalidateQueries({ queryKey: ["org", org.id, "custom-fields"] });
      setLabel("");
      setOptions("");
      setRequired(false);
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!toKey(label)) return setError("Enter a label");
    create.mutate();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New custom field"
      description="Extra information your team records on contacts or leads."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="field-form" loading={create.isPending}>
            Add field
          </Button>
        </>
      }
    >
      <form id="field-form" onSubmit={submit} noValidate className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Applies to">
            <NativeSelect value={entity} onChange={(e) => setEntity(e.target.value as "contact" | "lead")}>
              <option value="contact">Contacts</option>
              <option value="lead">Leads</option>
            </NativeSelect>
          </Field>
          <Field label="Type">
            <NativeSelect value={type} onChange={(e) => setType(e.target.value as CustomFieldType)}>
              {TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <Field label="Label" hint={label ? `Stored as “${toKey(label)}”` : "e.g. City, Customer segment, GST number"}>
          <Input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} maxLength={100} />
        </Field>
        {type === "select" && (
          <Field label="Options" hint="Separate with commas.">
            <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Retail, Wholesale, Distributor" />
          </Field>
        )}
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} className="accent-[var(--color-primary)]" />
          Required
        </label>
      </form>
    </Dialog>
  );
}

export function CustomFieldsCard() {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const canEdit = org.can("org.update");
  const fields = useQuery({ queryKey: orgKeys.scoped(org.id, "custom-fields", "all"), queryFn: () => crmApi.customFields(org.id, undefined, true) });
  const archive = useMutation({
    mutationFn: (f: CustomField) => crmApi.updateCustomField(org.id, f.id, { archived: !f.archived }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["org", org.id, "custom-fields"] }),
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <Card>
      <CardHeader
        title="Custom fields"
        description="Fields shown on contact and lead forms. Archived fields keep their data but are hidden."
        actions={canEdit && <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add field</Button>}
      />
      {fields.isLoading ? (
        <LoadingRows rows={2} />
      ) : !fields.data?.length ? (
        <EmptyState icon={SlidersHorizontal} title="No custom fields" description="Add fields like City or Customer segment to capture what matters to your business." className="py-8" />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Field</TH>
              <TH className="w-28">Applies to</TH>
              <TH className="w-36">Type</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {fields.data.map((f) => (
              <TR key={f.id} className={f.archived ? "opacity-60" : undefined}>
                <TD>
                  <span className="font-medium">{f.label}</span> {f.required && <Badge tone="warning">Required</Badge>} {f.archived && <Badge>Archived</Badge>}
                  <p className="font-mono text-[11px] text-subtle">{f.key}</p>
                  {f.field_type === "select" && <p className="text-xs text-muted">{f.options.join(" · ")}</p>}
                </TD>
                <TD className="capitalize">{f.entity}s</TD>
                <TD>{TYPES.find((t) => t.key === f.field_type)?.label}</TD>
                <TD className="text-right">
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => archive.mutate(f)}>
                      {f.archived ? "Restore" : "Archive"}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
      <NewFieldDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
