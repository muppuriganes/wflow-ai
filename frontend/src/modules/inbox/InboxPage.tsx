import { useQuery } from "@tanstack/react-query";
import { Archive, CheckCircle2, Inbox as InboxIcon, MessagesSquare, Search, User, Users } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { errorMessage } from "@/services/api";
import { channelsApi } from "@/services/channels";
import { type InboxFilters, type InboxView, inboxApi } from "@/services/inbox";
import { usePollInterval } from "@/stores/live";
import { orgKeys, useCurrentOrg } from "@/stores/organization";
import type { InboxConversation } from "@/types/api";
import { cn } from "@/utils/cn";
import { formatRelative } from "@/utils/format";
import { ConversationView } from "./ConversationView";
import { contactName, initials, PRIORITY_LABELS, STATUS_LABELS } from "./meta";
import { TagList } from "./TagEditor";

const VIEWS: { key: InboxView; label: string; icon: typeof User; count?: "mine" | "unassigned" | "open" | "resolved" }[] = [
  { key: "mine", label: "Assigned to me", icon: User, count: "mine" },
  { key: "unassigned", label: "Unassigned", icon: Users, count: "unassigned" },
  { key: "active", label: "All open", icon: InboxIcon, count: "open" },
  { key: "resolved", label: "Resolved", icon: CheckCircle2, count: "resolved" },
  { key: "archived", label: "Archived", icon: Archive },
];

function ConversationRow({ c, active, onSelect }: { c: InboxConversation; active: boolean; onSelect: () => void }) {
  const name = contactName(c.contact);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={active || undefined}
        className={cn(
          "flex w-full gap-3 border-l-2 border-transparent px-3 py-2.5 text-left hover:bg-surface-muted",
          active && "border-primary bg-primary-soft hover:bg-primary-soft",
        )}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-semibold text-muted">
          {initials(name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className={cn("truncate", c.unread_count ? "font-semibold" : "font-medium")}>{name}</span>
            <span className="shrink-0 text-[11px] text-subtle">{c.last_message_at ? formatRelative(c.last_message_at) : ""}</span>
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread_count ? "text-foreground" : "text-muted")}>
              {c.last_message_preview ?? "—"}
            </span>
            {c.unread_count > 0 && <Badge tone="primary">{c.unread_count}</Badge>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1">
            {c.priority !== "normal" && <Badge tone={PRIORITY_LABELS[c.priority].tone}>{PRIORITY_LABELS[c.priority].label}</Badge>}
            {c.status === "PENDING" && <Badge tone={STATUS_LABELS.PENDING.tone}>Pending</Badge>}
            {c.assignee && <span className="text-[11px] text-muted">→ {c.assignee.full_name}</span>}
            <TagList tags={c.contact.tags.slice(0, 2)} />
          </span>
        </span>
      </button>
    </li>
  );
}

export function InboxPage() {
  const org = useCurrentOrg();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [params, setParams] = useSearchParams();
  const view = (params.get("view") as InboxView | null) ?? "mine";
  const [search, setSearch] = useState("");
  const q = useDebounced(search);
  const [connectionId, setConnectionId] = useState("");
  const [tagId, setTagId] = useState("");
  const poll = usePollInterval(8000);

  const filters: InboxFilters = { view, q: q || undefined, connection_id: connectionId || undefined, tag_id: tagId || undefined };
  const list = useQuery({
    queryKey: orgKeys.scoped(org.id, "inbox", "list", filters),
    queryFn: () => inboxApi.list(org.id, filters),
    refetchInterval: poll,
  });
  const counts = useQuery({ queryKey: orgKeys.scoped(org.id, "inbox", "counts"), queryFn: () => inboxApi.counts(org.id), refetchInterval: poll });
  const connections = useQuery({
    queryKey: orgKeys.scoped(org.id, "connections"),
    queryFn: () => channelsApi.list(org.id),
    enabled: org.can("connections.read"),
  });
  const tags = useQuery({ queryKey: orgKeys.scoped(org.id, "tags"), queryFn: () => inboxApi.tags(org.id), enabled: org.can("contacts.read") });

  if (!org.can("inbox.read")) {
    return (
      <div className="p-6">
        <Card>
          <EmptyState icon={MessagesSquare} title="No access" description="Your role does not include the inbox." />
        </Card>
      </div>
    );
  }

  const select = (id: string) => navigate({ pathname: `/inbox/${id}`, search: params.toString() });
  const items = list.data?.items ?? [];

  return (
    // Three panes filling the app shell's full-bleed area.
    <div className="flex h-full overflow-hidden bg-surface">
      <nav aria-label="Inbox views" className="hidden w-52 shrink-0 space-y-4 border-r p-3 lg:block">
        <ul className="space-y-px">
          {VIEWS.map((v) => (
            <li key={v.key}>
              <button
                type="button"
                onClick={() => setParams(v.key === "mine" ? {} : { view: v.key })}
                className={cn(
                  "flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-muted hover:bg-surface-muted hover:text-foreground",
                  view === v.key && "bg-primary-soft font-medium text-primary hover:bg-primary-soft hover:text-primary",
                )}
              >
                <v.icon className="size-4" aria-hidden />
                <span className="flex-1 text-left">{v.label}</span>
                {v.count && counts.data && <span className="text-[11px]">{counts.data[v.count]}</span>}
              </button>
            </li>
          ))}
        </ul>
        {(connections.data?.length ?? 0) > 1 && (
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted">Channel</span>
            <NativeSelect className="h-7 text-xs" value={connectionId} onChange={(e) => setConnectionId(e.target.value)}>
              <option value="">All channels</option>
              {connections.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.display_name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
        {(tags.data?.length ?? 0) > 0 && (
          <label className="block space-y-1 text-xs">
            <span className="font-medium text-muted">Tag</span>
            <NativeSelect className="h-7 text-xs" value={tagId} onChange={(e) => setTagId(e.target.value)}>
              <option value="">Any tag</option>
              {tags.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </label>
        )}
      </nav>

      <section className={cn("flex w-full shrink-0 flex-col border-r md:w-80", conversationId && "hidden md:flex")} aria-label="Conversations">
        <div className="space-y-2 border-b p-3">
          <NativeSelect className="h-8 lg:hidden" aria-label="View" value={view} onChange={(e) => setParams(e.target.value === "mine" ? {} : { view: e.target.value })}>
            {VIEWS.map((v) => (
              <option key={v.key} value={v.key}>
                {v.label}
                {v.count && counts.data ? ` (${counts.data[v.count]})` : ""}
              </option>
            ))}
          </NativeSelect>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 size-4 text-subtle" aria-hidden />
            <Input className="pl-8" placeholder="Search name, number or message" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search conversations" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <LoadingRows rows={6} />
          ) : list.error ? (
            <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
          ) : !items.length ? (
            <EmptyState
              icon={MessagesSquare}
              title={q ? "No matches" : view === "mine" ? "Nothing assigned to you" : "No conversations here"}
              description={
                q ? "Try a different name, number or word." : view === "mine" ? "Pick one from Unassigned to start helping a customer." : "New customer messages appear here automatically."
              }
            />
          ) : (
            <ul className="divide-y">
              {items.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === conversationId} onSelect={() => select(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={cn("min-w-0 flex-1", conversationId ? "flex" : "hidden md:flex")} aria-label="Conversation">
        {conversationId ? (
          <ConversationView key={conversationId} conversationId={conversationId} onBack={() => navigate({ pathname: "/inbox", search: params.toString() })} />
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <EmptyState icon={MessagesSquare} title="Select a conversation" description="Choose a conversation on the left to read and reply." />
          </div>
        )}
      </section>
    </div>
  );
}
