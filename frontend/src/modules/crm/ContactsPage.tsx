import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Contact as ContactIcon, Plus, Search } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { Alert, EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useDebounced } from "@/hooks/useDebounced";
import { TagList } from "@/modules/inbox/TagEditor";
import { ApiError, errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { inboxApi } from "@/services/inbox";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import { formatRelative } from "@/utils/format";
import { CrmTabs } from "./CrmTabs";
import { CustomFieldInputs } from "./CustomFieldInputs";

export function ContactDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fields = useQuery({ queryKey: orgKeys.scoped(org.id, "custom-fields", "contact"), queryFn: () => crmApi.customFields(org.id, "contact") });
  const [form, setForm] = useState({ display_name: "", phone_number: "", email: "", company: "" });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<{ message: string; existingId?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setForm({ display_name: "", phone_number: "", email: "", company: "" });
      setCustom({});
      setError(null);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.display_name.trim()) return setError({ message: "Enter a name" });
    setSaving(true);
    try {
      const contact = await crmApi.createContact(org.id, {
        display_name: form.display_name.trim(),
        phone_number: form.phone_number.trim() || null,
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        custom_fields: Object.fromEntries(Object.entries(custom).filter(([, v]) => v !== null && v !== "")),
      });
      await queryClient.invalidateQueries({ queryKey: ["org", org.id, "contacts"] });
      toast.success("Contact created");
      onOpenChange(false);
      navigate(`/contacts/${contact.id}`);
    } catch (err) {
      const existingId = err instanceof ApiError && err.code === "contact_exists" ? (err.details as { contact_id?: string })?.contact_id : undefined;
      setError({ message: err instanceof ApiError && err.code === "validation_error" ? Object.values(err.fieldErrors)[0] ?? err.message : errorMessage(err), existingId });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      title="New contact"
      description="Adding a phone number links future WhatsApp messages from it to this contact."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="contact-form" loading={saving}>
            Create contact
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert tone="danger">
              {error.message}{" "}
              {error.existingId && (
                <Link to={`/contacts/${error.existingId}`} className="font-medium underline" onClick={() => onOpenChange(false)}>
                  Open existing contact
                </Link>
              )}
            </Alert>
          </div>
        )}
        <Field label="Name *" className="sm:col-span-2">
          <Input autoFocus value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
        </Field>
        <Field label="Phone" hint="With country code, e.g. +91 98765 43210">
          <Input type="tel" value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </Field>
        <Field label="Company" className="sm:col-span-2">
          <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
        </Field>
        <CustomFieldInputs fields={fields.data ?? []} values={custom} onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))} />
      </form>
    </Dialog>
  );
}

export function ContactsPage() {
  const org = useCurrentOrg();
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [tagId, setTagId] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => setPage(1), [q, tagId]);

  const contacts = useQuery({
    queryKey: orgKeys.scoped(org.id, "contacts", "list", q, tagId, page),
    queryFn: () => crmApi.contacts(org.id, q, tagId || undefined, page),
    placeholderData: keepPreviousData,
  });
  const tags = useQuery({ queryKey: orgKeys.scoped(org.id, "tags"), queryFn: () => inboxApi.tags(org.id) });
  const pages = contacts.data ? Math.max(1, Math.ceil(contacts.data.total / contacts.data.page_size)) : 1;

  return (
    <>
      <PageHeader
        title="Contacts & CRM"
        description="Everyone your business talks to, with their leads, tasks and history."
        actions={
          org.can("contacts.manage") && (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus /> New contact
            </Button>
          )
        }
      />
      <CrmTabs />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" aria-hidden />
            <Input className="pl-8" placeholder="Search name, phone, email or company" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
          </div>
          {(tags.data?.length ?? 0) > 0 && (
            <NativeSelect className="w-44" aria-label="Filter by tag" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">All tags</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </div>
        {contacts.isLoading ? (
          <LoadingRows rows={5} />
        ) : contacts.error ? (
          <ErrorState message={errorMessage(contacts.error)} onRetry={() => void contacts.refetch()} />
        ) : !contacts.data?.items.length ? (
          <EmptyState
            icon={ContactIcon}
            title={q || tagId ? "No matching contacts" : "No contacts yet"}
            description={q || tagId ? "Try another search." : "Contacts are created automatically when customers message you, or add one yourself."}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH className="w-40">Phone</TH>
                  <TH className="hidden md:table-cell">Tags</TH>
                  <TH className="w-24">Open leads</TH>
                  <TH className="w-36">Last message</TH>
                </TR>
              </THead>
              <TBody>
                {contacts.data.items.map((c) => (
                  <TR key={c.id} className="hover:bg-surface-muted/50">
                    <TD>
                      <Link to={`/contacts/${c.id}`} className="font-medium hover:text-primary">
                        {c.display_name ?? "Unnamed"}
                      </Link>
                      <p className="text-xs text-muted">
                        {c.company ?? c.email ?? ""}
                        {c.opted_out_at && <Badge tone="danger" className="ml-1">Opted out</Badge>}
                      </p>
                    </TD>
                    <TD className="font-mono text-xs">{c.phone_number ? `+${c.phone_number}` : "—"}</TD>
                    <TD className="hidden md:table-cell">
                      <TagList tags={c.tags} />
                    </TD>
                    <TD>{c.open_leads || "—"}</TD>
                    <TD className="text-muted">{c.last_inbound_at ? formatRelative(c.last_inbound_at) : "—"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {pages > 1 && (
              <div className="flex items-center justify-between border-t px-4 py-2.5 text-xs text-muted">
                <span>
                  {contacts.data.total} contacts · page {page} of {pages}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                    Previous
                  </Button>
                  <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>
      <ContactDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}
