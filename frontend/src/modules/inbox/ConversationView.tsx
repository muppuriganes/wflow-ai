import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Hand,
  ListTodo,
  Paperclip,
  RotateCcw,
  Send,
  Target,
  X,
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { Alert, ErrorState, LoadingRows, Spinner } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { LeadDialog } from "@/modules/crm/LeadDialog";
import { TaskDialog } from "@/modules/crm/TaskDialog";
import { errorMessage } from "@/services/api";
import { inboxApi } from "@/services/inbox";
import { useAuth } from "@/stores/auth";
import { usePollInterval } from "@/stores/live";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { InboxConversation, InboxMessage, Priority } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";
import { Attachment } from "./Attachment";
import { contactName, newClientId, PRIORITY_LABELS, STATUS_LABELS } from "./meta";
import { TagEditor } from "./TagEditor";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.pptx,.txt,.csv,audio/mpeg,audio/ogg,video/mp4";

function DeliveryIcon({ message }: { message: InboxMessage }) {
  const icons: Record<string, { icon: typeof Check; label: string; className?: string }> = {
    queued: { icon: Clock, label: "Sending" },
    sent: { icon: Check, label: "Sent" },
    delivered: { icon: CheckCheck, label: "Delivered" },
    read: { icon: CheckCheck, label: "Read", className: "text-info" },
    played: { icon: CheckCheck, label: "Played", className: "text-info" },
    failed: { icon: AlertCircle, label: message.error ?? "Failed", className: "text-danger" },
  };
  const meta = icons[message.status];
  if (!meta) return null;
  return (
    <Tooltip content={meta.label}>
      <meta.icon className={cn("size-3.5", meta.className)} aria-label={meta.label} />
    </Tooltip>
  );
}

function Bubble({ message }: { message: InboxMessage }) {
  const outbound = message.direction === "outbound";
  return (
    <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[78%] space-y-1.5 rounded-lg px-3 py-2 text-[13px] shadow-card", outbound ? "bg-primary-soft" : "bg-surface")}>
        {message.attachments.map((a) => (
          <Attachment key={a.id} attachment={a} />
        ))}
        {message.content ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          !message.attachments.length && <p className="italic text-muted">[{message.message_type} — not shown]</p>
        )}
        <p className="flex items-center justify-end gap-1 text-[10px] text-muted">
          {outbound && message.sent_by && <span>{message.sent_by.full_name} ·</span>}
          <span title={formatDateTime(message.created_at)}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {outbound && <DeliveryIcon message={message} />}
        </p>
      </div>
    </div>
  );
}

function Composer({ conversation }: { conversation: InboxConversation }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const optedOut = conversation.contact.opted_out_at !== null;
  const disconnected = conversation.connection_status !== "CONNECTED";
  const canReply = org.can("inbox.reply") && !optedOut && !disconnected;

  const send = useMutation({
    mutationFn: ({ body, attachment, key }: { body: string; attachment: File | null; key: string }) =>
      attachment
        ? inboxApi.sendFile(org.id, conversation.id, attachment, body, key)
        : inboxApi.send(org.id, conversation.id, body, key),
    onSuccess: () => {
      setText("");
      setFile(null);
      for (const k of ["messages", "inbox", "conversation"]) void queryClient.invalidateQueries({ queryKey: ["org", org.id, k] });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if ((text.trim() || file) && !send.isPending) send.mutate({ body: text.trim(), attachment: file, key: newClientId() });
  };

  return (
    <form onSubmit={submit} className="space-y-2 border-t bg-surface p-3">
      {send.error && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
      {!canReply && (
        <p className="text-xs text-muted">
          {optedOut
            ? "This contact opted out (sent STOP). Messages are blocked until they send START."
            : disconnected
              ? `${conversation.connection_name} is not connected. Reconnect it under Channels to reply.`
              : "Your role can read conversations but not reply."}
        </p>
      )}
      {file && (
        <div className="flex items-center gap-2 rounded-md border bg-surface-muted px-2 py-1 text-xs">
          <Paperclip className="size-3.5 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <span className="text-muted">{Math.ceil(file.size / 1024)} KB</span>
          <button type="button" onClick={() => setFile(null)} aria-label="Remove attachment" className="rounded-sm p-0.5 hover:bg-surface">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > 16 * 1024 * 1024) toast.error("Files can be at most 16 MB");
            else setFile(f);
            e.target.value = "";
          }}
        />
        <Tooltip content="Attach a file (max 16 MB)">
          <Button type="button" variant="ghost" size="icon" disabled={!canReply} onClick={() => fileInput.current?.click()} aria-label="Attach file">
            <Paperclip />
          </Button>
        </Tooltip>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          rows={2}
          maxLength={4096}
          disabled={!canReply}
          placeholder={file ? "Add a caption (optional)…" : "Type a reply…  (Enter to send, Shift+Enter for a new line)"}
          aria-label="Reply"
          className="min-h-10 flex-1 resize-none rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] placeholder:text-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-surface-muted"
        />
        <Button type="submit" disabled={!canReply || (!text.trim() && !file)} loading={send.isPending} aria-label="Send">
          <Send />
        </Button>
      </div>
    </form>
  );
}

function Notes({ conversationId }: { conversationId: string }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const notes = useQuery({ queryKey: orgKeys.scoped(org.id, "notes", conversationId), queryFn: () => inboxApi.notes(org.id, conversationId) });
  const add = useMutation({
    mutationFn: () => inboxApi.addNote(org.id, conversationId, body.trim()),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "notes", conversationId) });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  return (
    <div className="space-y-2">
      {notes.data?.length ? (
        <ul className="space-y-2">
          {notes.data.map((n) => (
            <li key={n.id} className="rounded-md border border-warning/20 bg-warning-soft/60 px-2.5 py-2 text-xs">
              <p className="whitespace-pre-wrap break-words text-foreground">{n.body}</p>
              <p className="mt-1 text-[11px] text-muted">
                {n.author?.full_name ?? "Someone"} · {formatRelative(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No internal notes yet. Notes are visible only to your team.</p>
      )}
      {org.can("inbox.reply") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
          className="space-y-1.5"
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={5000}
            placeholder="Add an internal note…"
            aria-label="Internal note"
            className="w-full resize-none rounded-md border border-border-strong bg-surface px-2.5 py-1.5 text-xs focus-visible:border-primary focus-visible:outline-none"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!body.trim()} loading={add.isPending}>
            Add note
          </Button>
        </form>
      )}
    </div>
  );
}

function DetailsPanel({ conversation }: { conversation: InboxConversation }) {
  const org = useCurrentOrg();
  const [leadOpen, setLeadOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const name = contactName(conversation.contact);
  return (
    <aside className="hidden w-72 shrink-0 space-y-5 overflow-y-auto border-l bg-surface p-4 xl:block" aria-label="Conversation details">
      <section className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Contact</p>
        <p className="font-medium">{name}</p>
        {conversation.contact.phone_number && <p className="font-mono text-xs text-muted">+{conversation.contact.phone_number}</p>}
        {conversation.contact.email && <p className="text-xs text-muted">{conversation.contact.email}</p>}
        <TagEditor contactId={conversation.contact.id} tags={conversation.contact.tags} />
        {org.can("contacts.read") && (
          <Link to={`/contacts/${conversation.contact.id}`} className="block pt-1 text-xs font-medium text-primary hover:underline">
            Open contact profile
          </Link>
        )}
      </section>
      {(org.can("leads.manage") || org.can("contacts.manage")) && (
        <section className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Quick actions</p>
          {org.can("leads.manage") && (
            <Button variant="secondary" size="sm" className="w-full justify-start" onClick={() => setLeadOpen(true)}>
              <Target /> Create lead
            </Button>
          )}
          {org.can("contacts.manage") && (
            <Button variant="secondary" size="sm" className="w-full justify-start" onClick={() => setTaskOpen(true)}>
              <ListTodo /> Add follow-up task
            </Button>
          )}
        </section>
      )}
      <section className="space-y-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-subtle">Internal notes</p>
        <Notes conversationId={conversation.id} />
      </section>
      <LeadDialog open={leadOpen} onOpenChange={setLeadOpen} contact={{ id: conversation.contact.id, name }} defaultSource="whatsapp" />
      <TaskDialog
        open={taskOpen}
        onOpenChange={setTaskOpen}
        link={{ contact_id: conversation.contact.id, conversation_id: conversation.id, label: name }}
      />
    </aside>
  );
}

function Header({ conversation, onBack }: { conversation: InboxConversation; onBack: () => void }) {
  const org = useCurrentOrg();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const assignees = useQuery({
    queryKey: orgKeys.scoped(org.id, "inbox", "assignees"),
    queryFn: () => inboxApi.assignees(org.id),
    staleTime: 60_000,
  });
  const done = (c: InboxConversation) => {
    queryClient.setQueryData(orgKeys.scoped(org.id, "conversation", c.id), c);
    void queryClient.invalidateQueries({ queryKey: ["org", org.id, "inbox"] });
  };
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const assign = useMutation({ mutationFn: (id: string | null) => inboxApi.assign(org.id, conversation.id, id), onSuccess: done, onError });
  const status = useMutation({ mutationFn: (s: InboxConversation["status"]) => inboxApi.setStatus(org.id, conversation.id, s), onSuccess: done, onError });
  const priority = useMutation({ mutationFn: (p: Priority) => inboxApi.setPriority(org.id, conversation.id, p), onSuccess: done, onError });
  const takeover = useMutation({ mutationFn: (v: boolean) => inboxApi.setTakeover(org.id, conversation.id, v), onSuccess: done, onError });

  const canReply = org.can("inbox.reply");
  const canAssign = org.can("inbox.assign");
  const resolved = conversation.status === "RESOLVED" || conversation.status === "ARCHIVED";
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-surface px-4 py-2.5">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
        <ArrowLeft />
      </Button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-medium">
          {contactName(conversation.contact)}
          <Badge tone={STATUS_LABELS[conversation.status].tone}>{STATUS_LABELS[conversation.status].label}</Badge>
          {conversation.automation_paused && <Badge tone="warning">Human handling</Badge>}
        </p>
        <p className="truncate text-xs text-muted">via {conversation.connection_name}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canAssign ? (
          <NativeSelect
            aria-label="Assignee"
            className="h-7 w-36 text-xs"
            value={conversation.assignee?.id ?? ""}
            onChange={(e) => assign.mutate(e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {assignees.data?.map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
          </NativeSelect>
        ) : (
          canReply &&
          !conversation.assignee && (
            <Button size="sm" variant="secondary" loading={assign.isPending} onClick={() => assign.mutate(user?.id ?? null)}>
              Take conversation
            </Button>
          )
        )}
        {canReply && (
          <NativeSelect aria-label="Priority" title="Priority" className="h-7 w-24 text-xs" value={conversation.priority} onChange={(e) => priority.mutate(e.target.value as Priority)}>
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p].label}
              </option>
            ))}
          </NativeSelect>
        )}
        {canReply && (
          <Tooltip content={conversation.automation_paused ? "Let automations reply again" : "Pause automations: a person handles this conversation"}>
            <Button size="sm" variant={conversation.automation_paused ? "primary" : "secondary"} onClick={() => takeover.mutate(!conversation.automation_paused)} aria-pressed={conversation.automation_paused}>
              <Hand /> {conversation.automation_paused ? "Handling" : "Take over"}
            </Button>
          </Tooltip>
        )}
        {canReply &&
          (resolved ? (
            <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate("OPEN")}>
              <RotateCcw /> Reopen
            </Button>
          ) : (
            <Button size="sm" loading={status.isPending} onClick={() => status.mutate("RESOLVED")}>
              <CheckCircle2 /> Resolve
            </Button>
          ))}
      </div>
    </header>
  );
}

export function ConversationView({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const org = useCurrentOrg();
  const poll = usePollInterval(5000);
  const bottom = useRef<HTMLDivElement>(null);
  const conversation = useQuery({
    queryKey: orgKeys.scoped(org.id, "conversation", conversationId),
    queryFn: () => inboxApi.get(org.id, conversationId),
    refetchInterval: poll,
  });
  const messages = useQuery({
    queryKey: orgKeys.scoped(org.id, "messages", conversationId),
    queryFn: () => inboxApi.messages(org.id, conversationId),
    refetchInterval: poll,
  });
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length, conversationId]);

  if (conversation.isLoading) return <div className="flex flex-1 items-center justify-center"><Spinner label="Loading conversation" /></div>;
  if (conversation.error) return <div className="flex-1"><ErrorState message={errorMessage(conversation.error)} onRetry={() => void conversation.refetch()} /></div>;
  const c = conversation.data!;
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header conversation={c} onBack={onBack} />
        <div className="flex-1 space-y-2 overflow-y-auto bg-surface-muted/50 px-4 py-4" aria-live="polite">
          {messages.isLoading && <LoadingRows rows={3} />}
          {messages.error && <ErrorState message={errorMessage(messages.error)} onRetry={() => void messages.refetch()} />}
          {messages.data?.map((m) => <Bubble key={m.id} message={m} />)}
          <div ref={bottom} />
        </div>
        <Composer conversation={c} />
      </div>
      <DetailsPanel conversation={c} />
    </div>
  );
}
