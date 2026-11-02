import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Check, CheckCheck, Clock, MessagesSquare, Send } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
import { errorMessage } from "@/services/api";
import { channelsApi } from "@/services/channels";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { ChatMessage, Connection, Conversation } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatDateTime, formatRelative } from "@/utils/format";
import { formatPhone } from "./status";

function DeliveryIcon({ message }: { message: ChatMessage }) {
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

function Thread({ conversation, connection }: { conversation: Conversation; connection: Connection }) {
  const org = useCurrentOrg();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const messagesKey = orgKeys.scoped(org.id, "messages", conversation.id);
  const messages = useQuery({
    queryKey: messagesKey,
    queryFn: () => channelsApi.messages(org.id, conversation.id),
    refetchInterval: 3000,
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.data?.length]);

  const send = useMutation({
    // A fresh idempotency key per message; retries of this mutation reuse it.
    mutationFn: ({ body, key }: { body: string; key: string }) => channelsApi.send(org.id, conversation.id, body, key),
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: messagesKey });
      void queryClient.invalidateQueries({ queryKey: orgKeys.scoped(org.id, "conversations") });
    },
  });

  const optedOut = conversation.contact.opted_out_at !== null;
  const canReply = org.can("inbox.reply") && connection.status === "CONNECTED" && !optedOut;
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim() && !send.isPending) send.mutate({ body: text.trim(), key: crypto.randomUUID().replace(/-/g, "") });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="truncate font-medium">{conversation.contact.display_name ?? formatPhone(conversation.contact.phone_number)}</p>
          <p className="font-mono text-xs text-muted">{formatPhone(conversation.contact.phone_number)}</p>
        </div>
        {optedOut && <Badge tone="danger">Opted out</Badge>}
      </header>
      <div className="min-h-64 flex-1 space-y-2 overflow-y-auto bg-surface-muted/40 px-4 py-4" aria-live="polite">
        {messages.isLoading && <LoadingRows rows={2} />}
        {messages.error && <ErrorState message={errorMessage(messages.error)} onRetry={() => void messages.refetch()} />}
        {messages.data?.map((m) => (
          <div key={m.id} className={cn("flex", m.direction === "outbound" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[75%] rounded-lg px-3 py-2 text-[13px] shadow-card",
                m.direction === "outbound" ? "bg-primary-soft text-foreground" : "bg-surface",
              )}
            >
              <p className="whitespace-pre-wrap break-words">
                {m.content ?? <span className="italic text-muted">[{m.message_type}]</span>}
              </p>
              <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-muted">
                <span title={formatDateTime(m.created_at)}>
                  {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                {m.direction === "outbound" && <DeliveryIcon message={m} />}
              </p>
            </div>
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form onSubmit={onSubmit} className="space-y-2 border-t p-3">
        {send.error && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        {!canReply && (
          <p className="text-xs text-muted">
            {optedOut
              ? "This contact sent STOP. Messages are blocked until they send START."
              : connection.status !== "CONNECTED"
                ? "Reconnect the channel to reply."
                : "Your role cannot reply to conversations."}
          </p>
        )}
        <div className="flex gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) onSubmit(e);
            }}
            rows={2}
            maxLength={4096}
            disabled={!canReply}
            placeholder="Type a reply…  (Enter to send, Shift+Enter for a new line)"
            aria-label="Reply"
            className="min-h-10 flex-1 resize-none rounded-md border border-border-strong bg-surface px-2.5 py-2 text-[13px] placeholder:text-subtle focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/15 disabled:bg-surface-muted"
          />
          <Button type="submit" disabled={!canReply || !text.trim()} loading={send.isPending} aria-label="Send">
            <Send />
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Basic per-channel conversation view. The full team inbox (assignment, notes, tags) is M3. */
export function ConversationsPanel({ connection }: { connection: Connection }) {
  const org = useCurrentOrg();
  const [selected, setSelected] = useState<string | null>(null);
  const conversations = useQuery({
    queryKey: orgKeys.scoped(org.id, "conversations", connection.id),
    queryFn: () => channelsApi.conversations(org.id, connection.id),
    refetchInterval: 5000,
  });

  if (!org.can("inbox.read")) return <EmptyState icon={MessagesSquare} title="No access" description="Your role cannot view conversations." />;
  if (conversations.isLoading) return <LoadingRows />;
  if (conversations.error) return <ErrorState message={errorMessage(conversations.error)} onRetry={() => void conversations.refetch()} />;
  const items = conversations.data?.items ?? [];
  if (!items.length) {
    return (
      <EmptyState
        icon={MessagesSquare}
        title="No conversations yet"
        description="When a customer messages this number, the conversation appears here. You can reply only to people who wrote first."
      />
    );
  }
  const current = items.find((c) => c.id === selected) ?? items[0]!;
  return (
    <div className="flex min-h-[460px] flex-col md:flex-row">
      <ul className="max-h-60 shrink-0 divide-y overflow-y-auto border-b md:max-h-none md:w-72 md:border-b-0 md:border-r">
        {items.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => setSelected(c.id)}
              className={cn(
                "flex w-full flex-col gap-0.5 px-4 py-2.5 text-left hover:bg-surface-muted",
                c.id === current.id && "bg-primary-soft hover:bg-primary-soft",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{c.contact.display_name ?? formatPhone(c.contact.phone_number)}</span>
                {c.unread_count > 0 && <Badge tone="primary">{c.unread_count}</Badge>}
              </span>
              <span className="truncate text-xs text-muted">{c.last_message_preview ?? "—"}</span>
              {c.last_message_at && <span className="text-[11px] text-subtle">{formatRelative(c.last_message_at)}</span>}
            </button>
          </li>
        ))}
      </ul>
      <Thread key={current.id} conversation={current} connection={connection} />
    </div>
  );
}
