import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, History, MessagesSquare, Plus, Target, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/states";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATUS_LABELS } from "@/modules/inbox/meta";
import { TagEditor } from "@/modules/inbox/TagEditor";
import { ApiError, errorMessage } from "@/services/api";
import { crmApi } from "@/services/crm";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { ContactDetail, ConversationStatus, Lead } from "@/types/api";
import { formatDateTime, formatRelative } from "@/utils/format";
import { CustomFieldInputs, formatCustomValue } from "./CustomFieldInputs";
import { LeadDialog } from "./LeadDialog";
import { formatMoney, STAGE_LABEL } from "./shared";
import { TaskDialog } from "./TaskDialog";
import { TaskList } from "./TaskList";

function ProfileCard({ contact }: { contact: ContactDetail }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const canManage = org.can("contacts.manage");
  const fields = useQuery({ queryKey: orgKeys.scoped(org.id, "custom-fields", "contact"), queryFn: () => crmApi.customFields(org.id, "contact") });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: "", phone_number: "", email: "", company: "" });
  const [custom, setCustom] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setForm({
      display_name: contact.display_name ?? "",
      phone_number: contact.phone_number ?? "",
      email: contact.email ?? "",
      company: contact.company ?? "",
    });
    setCustom(contact.custom_fields);
    // Reset only when entering/leaving edit mode, so live refreshes never wipe unsaved edits.
  }, [contact.id, editing]);

  const save = useMutation({
    mutationFn: () =>
      crmApi.updateContact(org.id, contact.id, {
        display_name: form.display_name.trim(),
        email: form.email.trim() || null,
        company: form.company.trim() || null,
        ...(contact.channel_type === "manual" ? { phone_number: form.phone_number.trim() || null } : {}),
        custom_fields: custom,
      }),
    onSuccess: () => {
      setEditing(false);
      toast.success("Contact saved");
      for (const k of ["contact", "contacts", "inbox"]) void queryClient.invalidateQueries({ queryKey: ["org", org.id, k] });
    },
    onError: (err) => toast.error(err instanceof ApiError && err.code === "validation_error" ? Object.values(err.fieldErrors)[0] ?? err.message : errorMessage(err)),
  });
  const consent = useMutation({
    mutationFn: (optedOut: boolean) => crmApi.setConsent(org.id, contact.id, optedOut),
    onSuccess: () => {
      for (const k of ["contact", "inbox", "conversation"]) void queryClient.invalidateQueries({ queryKey: ["org", org.id, k] });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Card>
      <CardHeader
        title="Profile"
        actions={canManage && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
      />
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <CardBody className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
            </Field>
            <Field label="Phone" hint={contact.channel_type !== "manual" ? "Set by the messaging channel." : undefined}>
              <Input value={form.phone_number} disabled={contact.channel_type !== "manual"} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
            <Field label="Company">
              <Input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
            </Field>
            <CustomFieldInputs fields={fields.data ?? []} values={custom} onChange={(k, v) => setCustom((c) => ({ ...c, [k]: v }))} />
          </CardBody>
          <CardFooter>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save
            </Button>
          </CardFooter>
        </form>
      ) : (
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
            {[
              ["Phone", contact.phone_number ? `+${contact.phone_number}` : "—"],
              ["Email", contact.email ?? "—"],
              ["Company", contact.company ?? "—"],
              ["Last message", contact.last_inbound_at ? formatRelative(contact.last_inbound_at) : "—"],
              ...(fields.data ?? []).map((f) => [f.label, formatCustomValue(f, contact.custom_fields[f.key])]),
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-0.5">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 space-y-2 border-t pt-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">Tags</span>
              <TagEditor contactId={contact.id} tags={contact.tags} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted">Messaging consent</span>
              {contact.opted_out_at ? <Badge tone="danger">Opted out</Badge> : <Badge tone={contact.consent_status === "engaged" ? "success" : "neutral"}>{contact.consent_status === "engaged" ? "Engaged" : "No messages yet"}</Badge>}
              {canManage && (
                <Button variant="link" size="sm" className="text-xs" loading={consent.isPending} onClick={() => consent.mutate(!contact.opted_out_at)}>
                  {contact.opted_out_at ? "Remove opt-out" : "Mark as opted out"}
                </Button>
              )}
            </div>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

function Timeline({ contactId }: { contactId: string }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const activities = useQuery({ queryKey: orgKeys.scoped(org.id, "contact", contactId, "activities"), queryFn: () => crmApi.activities(org.id, contactId) });
  const add = useMutation({
    mutationFn: () => crmApi.addActivityNote(org.id, contactId, body.trim()),
    onSuccess: (data) => {
      setBody("");
      queryClient.setQueryData(orgKeys.scoped(org.id, "contact", contactId, "activities"), data);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div>
      {org.can("contacts.manage") && (
        <form
          className="flex gap-2 border-b p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Log a call, meeting or note…" aria-label="Add note" maxLength={5000} />
          <Button type="submit" variant="secondary" disabled={!body.trim()} loading={add.isPending}>
            Add
          </Button>
        </form>
      )}
      {activities.isLoading ? (
        <Spinner className="p-4" />
      ) : !activities.data?.length ? (
        <EmptyState icon={History} title="No activity yet" className="py-8" />
      ) : (
        <ol className="space-y-3 p-4">
          {activities.data.map((a) => (
            <li key={a.id} className="flex gap-3">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" aria-hidden />
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-[13px]">{a.summary}</p>
                <p className="text-[11px] text-muted">
                  {a.actor?.full_name ?? "System"} · {formatDateTime(a.created_at)}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function LeadsList({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  if (!leads.length) return <EmptyState icon={Target} title="No leads for this contact" className="py-8" />;
  return (
    <ul className="divide-y">
      {leads.map((l) => (
        <li key={l.id}>
          <button type="button" onClick={() => onOpen(l)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-surface-muted">
            <span className="min-w-0">
              <span className="block truncate font-medium">{l.title}</span>
              <span className="text-xs text-muted">{l.owner?.full_name ?? "No owner"}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="text-xs">{formatMoney(l.value_amount, l.currency)}</span>
              <Badge tone={l.stage === "CONVERTED" ? "success" : l.stage === "LOST" ? "danger" : "primary"}>{STAGE_LABEL[l.stage]}</Badge>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ContactDetailPage() {
  const { contactId = "" } = useParams();
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [leadDialog, setLeadDialog] = useState<{ open: boolean; lead: Lead | null }>({ open: false, lead: null });
  const [taskOpen, setTaskOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const contact = useQuery({ queryKey: orgKeys.scoped(org.id, "contact", contactId), queryFn: () => crmApi.contact(org.id, contactId) });
  const remove = useMutation({
    mutationFn: () => crmApi.deleteContact(org.id, contactId),
    onSuccess: () => {
      toast.success("Contact deleted");
      void queryClient.invalidateQueries({ queryKey: ["org", org.id, "contacts"] });
      navigate("/contacts");
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (contact.isLoading) return <Spinner label="Loading contact" />;
  if (contact.error)
    return contact.error instanceof ApiError && contact.error.status === 404 ? (
      <Card>
        <EmptyState icon={History} title="Contact not found" action={<Button asChild variant="secondary"><Link to="/contacts">Back to contacts</Link></Button>} />
      </Card>
    ) : (
      <ErrorState message={errorMessage(contact.error)} onRetry={() => void contact.refetch()} />
    );
  const c = contact.data!;
  const name = c.display_name ?? (c.phone_number ? `+${c.phone_number}` : "Contact");

  return (
    <>
      <Link to="/contacts" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden /> Contacts
      </Link>
      <PageHeader
        title={name}
        description={c.company ?? undefined}
        actions={
          <>
            {org.can("contacts.manage") && (
              <Button variant="secondary" onClick={() => setTaskOpen(true)}>
                <Plus /> Task
              </Button>
            )}
            {org.can("leads.manage") && (
              <Button onClick={() => setLeadDialog({ open: true, lead: null })}>
                <Target /> New lead
              </Button>
            )}
            {org.can("contacts.manage") && (
              <Button variant="danger-outline" size="icon" aria-label="Delete contact" onClick={() => setDeleteOpen(true)}>
                <Trash2 />
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <ProfileCard contact={c} />
          <Card>
            <Tabs defaultValue="timeline">
              <TabsList className="px-4 pt-3">
                <TabsTrigger value="timeline">Timeline</TabsTrigger>
                <TabsTrigger value="conversations">Conversations ({c.conversations.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="timeline" className="pt-0">
                <Timeline contactId={c.id} />
              </TabsContent>
              <TabsContent value="conversations" className="pt-0">
                {c.conversations.length ? (
                  <ul className="divide-y">
                    {c.conversations.map((conv) => (
                      <li key={conv.id}>
                        <Link to={`/inbox/${conv.id}?view=all`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-surface-muted">
                          <span className="min-w-0">
                            <span className="block truncate text-[13px]">{conv.last_message_preview ?? "—"}</span>
                            <span className="text-xs text-muted">
                              {conv.connection_name} · {conv.last_message_at ? formatRelative(conv.last_message_at) : ""}
                            </span>
                          </span>
                          <Badge tone={STATUS_LABELS[conv.status as ConversationStatus]?.tone ?? "neutral"}>
                            {STATUS_LABELS[conv.status as ConversationStatus]?.label ?? conv.status}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState icon={MessagesSquare} title="No conversations yet" className="py-8" />
                )}
              </TabsContent>
            </Tabs>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Leads (${c.leads.length})`} />
            <LeadsList leads={c.leads} onOpen={(lead) => setLeadDialog({ open: true, lead })} />
          </Card>
          <Card>
            <CardHeader title="Tasks" />
            <TaskList tasks={c.tasks} emptyText="No tasks for this contact" />
          </Card>
        </div>
      </div>
      <LeadDialog
        open={leadDialog.open}
        onOpenChange={(open) => setLeadDialog((d) => ({ ...d, open }))}
        lead={leadDialog.lead}
        contact={{ id: c.id, name }}
      />
      <TaskDialog open={taskOpen} onOpenChange={setTaskOpen} link={{ contact_id: c.id, label: name }} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${name}?`}
        description="The contact is removed from lists. Conversations and their history are kept, and the contact returns if they message again."
        confirmLabel="Delete contact"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </>
  );
}
