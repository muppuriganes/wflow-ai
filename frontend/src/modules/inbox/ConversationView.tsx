import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  CheckCircle2,
  Clock,
  Copy,
  Hand,
  ListTodo,
  MessageSquare,
  PanelRight,
  PanelRightClose,
  Paperclip,
  RotateCcw,
  Send,
  StickyNote,
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
import { usePollInterval } from "@/stores/live";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { InboxConversation, InboxMessage, Priority } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";
import { Attachment } from "./Attachment";
import { contactName, initials, newClientId, PRIORITY_LABELS, STATUS_LABELS } from "./meta";
import { TagEditor } from "./TagEditor";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf,.docx,.xlsx,.pptx,.txt,.csv,audio/mpeg,audio/ogg,video/mp4";

function DeliveryIcon({ message }: { message: InboxMessage }) {
  const icons: Record<string, { icon: typeof Check; label: string; className?: string }> = {
    queued: { icon: Clock, label: "Sending…" },
    sent: { icon: Check, label: "Sent" },
    delivered: { icon: CheckCheck, label: "Delivered" },
    read: { icon: CheckCheck, label: "Read", className: "text-emerald-300" },
    played: { icon: CheckCheck, label: "Played", className: "text-emerald-300" },
    failed: { icon: AlertCircle, label: message.error ?? "Failed to deliver", className: "text-red-400" },
  };
  const meta = icons[message.status];
  if (!meta) return null;
  return (
    <Tooltip content={meta.label}>
      <span className="inline-flex items-center">
        <meta.icon className={cn("size-3.5", meta.className)} aria-label={meta.label} />
      </span>
    </Tooltip>
  );
}

function formatDateSeparator(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date();
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function Bubble({ message }: { message: InboxMessage }) {
  const outbound = message.direction === "outbound";
  const isFailed = message.status === "failed";

  return (
    <div className={cn("group flex w-full", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-md sm:max-w-xl lg:max-w-2xl space-y-1.5 px-4 py-2.5 text-[13px] shadow-card transition-all",
          outbound
            ? "rounded-2xl rounded-tr-xs bg-primary text-white"
            : "rounded-2xl rounded-tl-xs border border-border bg-surface text-foreground",
          isFailed && "ring-2 ring-danger/40 bg-red-50 text-red-950 border-red-200"
        )}
      >
        {message.attachments.map((a) => (
          <Attachment key={a.id} attachment={a} />
        ))}
        {message.content ? (
          <p className="whitespace-pre-wrap break-words leading-relaxed select-text font-normal">{message.content}</p>
        ) : (
          !message.attachments.length && (
            <p className={cn("italic", outbound ? "text-purple-200" : "text-muted")}>[{message.message_type} — not shown]</p>
          )
        )}
        <div
          className={cn(
            "flex items-center justify-end gap-1.5 text-[10px]",
            outbound && !isFailed ? "text-purple-200" : isFailed ? "text-red-600 font-semibold" : "text-muted"
          )}
        >
          {outbound && message.sent_by && <span className="font-medium">{message.sent_by.full_name} ·</span>}
          <span title={formatDateTime(message.created_at)}>
            {new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
          {outbound && <DeliveryIcon message={message} />}
        </div>
      </div>
    </div>
  );
}

function Composer({
  conversation,
  onAddNote,
}: {
  conversation: InboxConversation;
  onAddNote: (note: string) => Promise<void>;
}) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
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
    onError: (err) => {
      toast.error(errorMessage(err));
    },
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "note") {
      if (!text.trim()) return;
      setIsSubmittingNote(true);
      try {
        await onAddNote(text.trim());
        setText("");
        toast.success("Note added");
      } catch (err) {
        toast.error(errorMessage(err));
      } finally {
        setIsSubmittingNote(false);
      }
      return;
    }

    if ((text.trim() || file) && !send.isPending) {
      send.mutate({ body: text.trim(), attachment: file, key: newClientId() });
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "border-t bg-surface p-3.5 transition-colors",
        mode === "note" && "bg-amber-50/40 border-amber-200/60"
      )}
    >
      {send.error && (
        <div className="mb-2">
          <Alert tone="danger">{errorMessage(send.error)}</Alert>
        </div>
      )}

      {/* Mode toggle bar */}
      <div className="mb-2 flex items-center justify-between">
        <div className="inline-flex rounded-lg border border-border bg-surface-muted/60 p-0.5 text-xs font-medium">
          <button
            type="button"
            onClick={() => setMode("reply")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
              mode === "reply"
                ? "bg-surface text-foreground shadow-xs"
                : "text-muted hover:text-foreground"
            )}
          >
            <MessageSquare className="size-3.5" />
            <span>Reply to customer</span>
          </button>
          <button
            type="button"
            onClick={() => setMode("note")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors",
              mode === "note"
                ? "bg-amber-100 text-amber-900 font-semibold shadow-xs"
                : "text-muted hover:text-foreground"
            )}
          >
            <StickyNote className="size-3.5" />
            <span>Internal note</span>
          </button>
        </div>

        <span className="hidden text-[11px] text-muted sm:inline">
          {mode === "reply" ? "Enter to send · Shift+Enter for new line" : "Visible only to your team"}
        </span>
      </div>

      {mode === "reply" && !canReply && (
        <p className="mb-2 text-xs text-muted">
          {optedOut
            ? "This contact opted out (sent STOP). Messages are blocked until they send START."
            : disconnected
              ? `${conversation.connection_name} is not connected. Reconnect it under Channels to reply.`
              : "Your role can read conversations but not reply."}
        </p>
      )}

      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-surface-muted px-2.5 py-1.5 text-xs">
          <Paperclip className="size-3.5 text-primary" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
          <span className="text-muted">{Math.ceil(file.size / 1024)} KB</span>
          <button
            type="button"
            onClick={() => setFile(null)}
            aria-label="Remove attachment"
            className="rounded p-0.5 text-muted hover:bg-surface hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-end gap-2">
        {mode === "reply" && (
          <>
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
            <Tooltip content="Attach a file (images, docs, audio up to 16 MB)">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={!canReply}
                onClick={() => fileInput.current?.click()}
                aria-label="Attach file"
                className="shrink-0 text-muted hover:text-foreground"
              >
                <Paperclip className="size-4" />
              </Button>
            </Tooltip>
          </>
        )}

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) submit(e);
          }}
          rows={2}
          maxLength={mode === "note" ? 5000 : 4096}
          disabled={mode === "reply" && !canReply}
          placeholder={
            mode === "note"
              ? "Write an internal team note (not sent to customer)…"
              : file
                ? "Add a caption (optional)…"
                : "Type a reply…  (Enter to send, Shift+Enter for newline)"
          }
          aria-label={mode === "note" ? "Internal note" : "Reply"}
          className={cn(
            "min-h-11 flex-1 resize-none rounded-lg border bg-surface px-3 py-2 text-[13px] placeholder:text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 disabled:bg-surface-muted",
            mode === "note"
              ? "border-amber-300 focus-visible:border-amber-400 focus-visible:ring-amber-200"
              : "border-border-strong focus-visible:border-primary focus-visible:ring-primary/20"
          )}
        />

        <Button
          type="submit"
          disabled={
            mode === "note"
              ? !text.trim() || isSubmittingNote
              : !canReply || (!text.trim() && !file) || send.isPending
          }
          loading={mode === "note" ? isSubmittingNote : send.isPending}
          variant={mode === "note" ? "secondary" : "primary"}
          aria-label={mode === "note" ? "Save note" : "Send reply"}
          className="shrink-0 gap-1.5"
        >
          {mode === "note" ? (
            <>
              <StickyNote className="size-3.5" /> Note
            </>
          ) : (
            <>
              <Send className="size-3.5" /> Send
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function NotesList({
  conversationId,
  onAddNoteRef,
}: {
  conversationId: string;
  onAddNoteRef: (fn: (note: string) => Promise<void>) => void;
}) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const notes = useQuery({
    queryKey: orgKeys.scoped(org.id, "notes", conversationId),
    queryFn: () => inboxApi.notes(org.id, conversationId),
  });

  const add = useMutation({
    mutationFn: (body: string) => inboxApi.addNote(org.id, conversationId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "notes", conversationId) });
    },
  });

  useEffect(() => {
    onAddNoteRef(async (body: string) => {
      await add.mutateAsync(body);
    });
  }, [conversationId, add, onAddNoteRef]);

  return (
    <div className="space-y-2">
      {notes.data?.length ? (
        <ul className="space-y-2">
          {notes.data.map((n) => (
            <li key={n.id} className="rounded-lg border border-amber-200/80 bg-amber-50/70 p-2.5 text-xs text-amber-950 shadow-xs">
              <p className="whitespace-pre-wrap break-words leading-relaxed font-normal">{n.body}</p>
              <p className="mt-1.5 text-[10px] text-amber-800/80 font-medium">
                {n.author?.full_name ?? "Team member"} · {formatRelative(n.created_at)}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">No internal notes yet. Switch to “Internal note” tab to collaborate privately.</p>
      )}
    </div>
  );
}

function DetailsPanel({
  conversation,
  onClose,
  onAddNoteRef,
}: {
  conversation: InboxConversation;
  onClose: () => void;
  onAddNoteRef: (fn: (note: string) => Promise<void>) => void;
}) {
  const org = useCurrentOrg();
  const [leadOpen, setLeadOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const name = contactName(conversation.contact);
  const phone = conversation.contact.phone_number;

  const copyPhone = () => {
    if (phone) {
      navigator.clipboard.writeText(`+${phone}`);
      toast.success("Phone number copied");
    }
  };

  return (
    <aside className="w-72 shrink-0 space-y-5 overflow-y-auto border-l bg-surface p-4 shadow-sm" aria-label="Conversation details">
      {/* Header with close button */}
      <div className="flex items-center justify-between border-b pb-3">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted">Customer details</span>
        <Button variant="ghost" size="icon" className="size-6 text-muted" onClick={onClose} title="Hide details">
          <PanelRightClose className="size-4" />
        </Button>
      </div>

      {/* Contact Profile Header */}
      <section className="space-y-2.5">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {initials(name)}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold text-foreground">{name}</h3>
            {phone && (
              <div className="flex items-center gap-1.5 text-xs text-muted font-mono">
                <span>+{phone}</span>
                <button
                  type="button"
                  onClick={copyPhone}
                  className="rounded p-0.5 text-subtle hover:bg-surface-muted hover:text-foreground"
                  title="Copy phone number"
                >
                  <Copy className="size-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        {conversation.contact.email && (
          <p className="truncate text-xs text-muted">
            <span className="text-subtle">Email:</span> {conversation.contact.email}
          </p>
        )}

        <div className="pt-1">
          <TagEditor contactId={conversation.contact.id} tags={conversation.contact.tags} />
        </div>

        {org.can("contacts.read") && (
          <Link
            to={`/contacts/${conversation.contact.id}`}
            className="inline-flex items-center gap-1 pt-1 text-xs font-semibold text-primary hover:underline"
          >
            Open full contact profile →
          </Link>
        )}
      </section>

      {/* Quick actions */}
      {(org.can("leads.manage") || org.can("contacts.manage")) && (
        <section className="space-y-2 border-t pt-3.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Quick actions</p>
          <div className="flex flex-col gap-1.5">
            {org.can("leads.manage") && (
              <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-8 text-xs" onClick={() => setLeadOpen(true)}>
                <Target className="size-3.5 text-primary" /> Create deal / lead
              </Button>
            )}
            {org.can("contacts.manage") && (
              <Button variant="secondary" size="sm" className="w-full justify-start gap-2 h-8 text-xs" onClick={() => setTaskOpen(true)}>
                <ListTodo className="size-3.5 text-warning" /> Add follow-up task
              </Button>
            )}
          </div>
        </section>
      )}

      {/* Internal notes */}
      <section className="space-y-2 border-t pt-3.5">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Internal notes</p>
          <StickyNote className="size-3.5 text-subtle" />
        </div>
        <NotesList conversationId={conversation.id} onAddNoteRef={onAddNoteRef} />
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

function Header({
  conversation,
  showDetails,
  onToggleDetails,
  onBack,
}: {
  conversation: InboxConversation;
  showDetails: boolean;
  onToggleDetails: () => void;
  onBack: () => void;
}) {
  const org = useCurrentOrg();
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
    <header className="flex h-14 items-center justify-between gap-3 border-b bg-surface px-3 sm:px-4 min-w-0">
      {/* Contact Identity - Guaranteed space, never crushed or overlapped */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
        <Button variant="ghost" size="icon" className="md:hidden size-8 shrink-0" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
          {initials(contactName(conversation.contact))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground text-sm truncate" title={contactName(conversation.contact)}>
              {contactName(conversation.contact)}
            </span>
            <Badge tone={STATUS_LABELS[conversation.status].tone} className="shrink-0 text-[10px] px-1.5 py-0">
              {STATUS_LABELS[conversation.status].label}
            </Badge>
            {conversation.automation_paused && (
              <Badge tone="warning" className="hidden xl:inline-flex shrink-0 text-[10px] px-1.5 py-0">
                Human
              </Badge>
            )}
          </div>
          <p className="truncate text-[11px] text-muted">
            via <span className="font-medium text-foreground">{conversation.connection_name}</span>
          </p>
        </div>
      </div>

      {/* Control Actions Row (Compact, responsive, never overflows) */}
      <div className="flex items-center gap-1.5 shrink-0">
        {canAssign && (
          <NativeSelect
            aria-label="Assignee"
            title="Assignee"
            className="h-8 w-24 sm:w-28 text-xs"
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
        )}

        {canReply && (
          <NativeSelect
            aria-label="Priority"
            title="Priority"
            className="h-8 w-20 text-xs hidden 2xl:inline-block"
            value={conversation.priority}
            onChange={(e) => priority.mutate(e.target.value as Priority)}
          >
            {(Object.keys(PRIORITY_LABELS) as Priority[]).map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p].label}
              </option>
            ))}
          </NativeSelect>
        )}

        {canReply && (
          <Tooltip content={conversation.automation_paused ? "Resume bot automations (currently human)" : "Pause automations: take over as human agent"}>
            <Button
              size="sm"
              variant={conversation.automation_paused ? "primary" : "secondary"}
              onClick={() => takeover.mutate(!conversation.automation_paused)}
              aria-pressed={conversation.automation_paused}
              className="h-8 px-2 text-xs gap-1"
            >
              <Hand className="size-3.5" />
              <span className="hidden xl:inline">{conversation.automation_paused ? "Handling" : "Take over"}</span>
            </Button>
          </Tooltip>
        )}

        {canReply &&
          (resolved ? (
            <Button size="sm" variant="secondary" loading={status.isPending} onClick={() => status.mutate("OPEN")} className="h-8 px-2.5 text-xs gap-1 font-medium">
              <RotateCcw className="size-3.5" /> <span className="hidden sm:inline">Reopen</span>
            </Button>
          ) : (
            <Button size="sm" variant="primary" loading={status.isPending} onClick={() => status.mutate("RESOLVED")} className="h-8 px-2.5 text-xs gap-1 font-medium">
              <CheckCircle2 className="size-3.5" /> <span className="hidden sm:inline">Resolve</span>
            </Button>
          ))}

        {/* Toggle Details Panel Button */}
        <Tooltip content={showDetails ? "Hide customer details" : "View customer details & notes"}>
          <Button
            size="icon"
            variant={showDetails ? "secondary" : "ghost"}
            onClick={onToggleDetails}
            aria-label="Toggle details panel"
            className={cn("size-8 text-muted hover:text-foreground shrink-0", showDetails && "bg-primary-soft text-primary font-bold")}
          >
            <PanelRight className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}

export function ConversationView({ conversationId, onBack }: { conversationId: string; onBack: () => void }) {
  const org = useCurrentOrg();
  const poll = usePollInterval(5000);
  const bottom = useRef<HTMLDivElement>(null);
  const addNoteRef = useRef<(body: string) => Promise<void>>(() => Promise.resolve());
  const [showDetails, setShowDetails] = useState(false);

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
    bottom.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.data?.length, conversationId]);

  if (conversation.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Loading conversation" />
      </div>
    );
  }

  if (conversation.error) {
    return (
      <div className="flex-1 p-6">
        <ErrorState message={errorMessage(conversation.error)} onRetry={() => void conversation.refetch()} />
      </div>
    );
  }

  const c = conversation.data!;
  const msgs = messages.data ?? [];

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {/* Main Chat Canvas (Wide, spacious, beautiful) */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Header
          conversation={c}
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(!showDetails)}
          onBack={onBack}
        />

        {/* Message Thread Area */}
        <div className="flex-1 space-y-3.5 overflow-y-auto bg-slate-50/70 p-4 md:p-6" aria-live="polite">
          {messages.isLoading && <LoadingRows rows={3} />}
          {messages.error && <ErrorState message={errorMessage(messages.error)} onRetry={() => void messages.refetch()} />}

          {msgs.map((m, index) => {
            const prev = msgs[index - 1];
            const showDate = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();

            return (
              <div key={m.id} className="space-y-3">
                {showDate && (
                  <div className="flex items-center justify-center my-2">
                    <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-muted shadow-xs border border-border">
                      {formatDateSeparator(m.created_at)}
                    </span>
                  </div>
                )}
                <Bubble message={m} />
              </div>
            );
          })}

          <div ref={bottom} />
        </div>

        <Composer
          conversation={c}
          onAddNote={async (note) => {
            await addNoteRef.current(note);
          }}
        />
      </div>

      {/* Customer Details Panel (Collapsible to prevent squishing the messages) */}
      {showDetails && (
        <DetailsPanel
          conversation={c}
          onClose={() => setShowDetails(false)}
          onAddNoteRef={(fn) => {
            addNoteRef.current = fn;
          }}
        />
      )}
    </div>
  );
}
