import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  CheckCircle2,
  Filter,
  Inbox as InboxIcon,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  User,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useDebounced } from "@/hooks/useDebounced";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ui/states";
import { Tooltip } from "@/components/ui/tooltip";
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

const VIEWS: { key: InboxView; label: string; shortLabel: string; icon: typeof User; count?: "mine" | "unassigned" | "open" | "resolved" }[] = [
  { key: "mine", label: "Assigned to me", shortLabel: "Mine", icon: User, count: "mine" },
  { key: "unassigned", label: "Unassigned", shortLabel: "Unassigned", icon: Users, count: "unassigned" },
  { key: "active", label: "All open", shortLabel: "All open", icon: InboxIcon, count: "open" },
  { key: "resolved", label: "Resolved", shortLabel: "Resolved", icon: CheckCircle2, count: "resolved" },
  { key: "archived", label: "Archived", shortLabel: "Archived", icon: Archive },
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
          "group flex w-full gap-2.5 border-l-2 border-transparent px-3 py-2.5 text-left transition-colors hover:bg-surface-muted/70",
          active && "border-primary bg-primary-soft/70 hover:bg-primary-soft/90",
        )}
      >
        <div className="relative shrink-0">
          <span
            className={cn(
              "flex size-8.5 items-center justify-center rounded-full text-xs font-semibold transition-colors",
              active ? "bg-primary text-white" : "bg-primary/10 text-primary group-hover:bg-primary/15"
            )}
          >
            {initials(name)}
          </span>
          <span
            className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-surface bg-emerald-500"
            title={c.connection_name}
          />
        </div>

        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-1.5">
            <span className={cn("truncate text-[13px]", c.unread_count ? "font-bold text-foreground" : "font-medium text-foreground")}>
              {name}
            </span>
            <span className="shrink-0 text-[10px] text-muted">
              {c.last_message_at ? formatRelative(c.last_message_at) : ""}
            </span>
          </span>

          <span className="mt-0.5 flex items-center gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-xs", c.unread_count ? "font-medium text-foreground" : "text-muted")}>
              {c.last_message_preview ?? "—"}
            </span>
            {c.unread_count > 0 && (
              <span className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white shadow-xs">
                {c.unread_count}
              </span>
            )}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1">
            {c.priority !== "normal" && (
              <Badge tone={PRIORITY_LABELS[c.priority].tone} className="text-[9px] px-1.5 py-0">
                {PRIORITY_LABELS[c.priority].label}
              </Badge>
            )}
            {c.status === "PENDING" && (
              <Badge tone={STATUS_LABELS.PENDING.tone} className="text-[9px] px-1.5 py-0">
                Pending
              </Badge>
            )}
            {c.assignee && <span className="text-[10px] text-muted truncate max-w-[100px]">→ {c.assignee.full_name}</span>}
            <TagList tags={c.contact.tags.slice(0, 1)} />
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
  const [foldersExpanded, setFoldersExpanded] = useState(false);
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
    // Three panes filling the app shell's full-bleed area with optimized horizontal space
    <div className="flex h-full overflow-hidden bg-surface">
      {/* Collapsible Left Folder Views Bar */}
      {foldersExpanded ? (
        <nav aria-label="Inbox views" className="hidden w-48 shrink-0 space-y-4 border-r bg-surface p-3 lg:block transition-all">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Folders</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-muted"
              onClick={() => setFoldersExpanded(false)}
              title="Collapse folder pane"
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>
          <ul className="space-y-1">
            {VIEWS.map((v) => {
              const countVal = v.count && counts.data ? counts.data[v.count] : undefined;
              const isSelected = view === v.key;

              return (
                <li key={v.key}>
                  <button
                    type="button"
                    onClick={() => setParams(v.key === "mine" ? {} : { view: v.key })}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-xs font-medium transition-colors",
                      isSelected
                        ? "bg-primary-soft text-primary font-semibold"
                        : "text-muted hover:bg-surface-muted hover:text-foreground",
                    )}
                  >
                    <v.icon className={cn("size-3.5", isSelected ? "text-primary" : "text-subtle")} aria-hidden />
                    <span className="flex-1 text-left truncate">{v.label}</span>
                    {countVal !== undefined && (
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.2 text-[10px] font-semibold",
                          isSelected
                            ? "bg-primary text-white"
                            : countVal > 0
                              ? "bg-surface-muted text-foreground"
                              : "text-muted"
                        )}
                      >
                        {countVal}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Filters */}
          <div className="space-y-2.5 border-t pt-3">
            <div className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
              <Filter className="size-3 text-subtle" /> Filters
            </div>

            {(connections.data?.length ?? 0) > 1 && (
              <label className="block space-y-1 text-xs">
                <span className="text-[10px] font-medium text-muted">Channel</span>
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
                <span className="text-[10px] font-medium text-muted">Tag</span>
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
          </div>
        </nav>
      ) : (
        /* Compact Slim Icon Rail (Saves ~180px width for the messages!) */
        <nav aria-label="Inbox views" className="hidden w-12 shrink-0 flex-col items-center border-r bg-surface py-3 space-y-2 lg:flex">
          <Tooltip content="Expand folder list" side="right">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-muted hover:text-foreground"
              onClick={() => setFoldersExpanded(true)}
              aria-label="Expand folder list"
            >
              <PanelLeftOpen className="size-4" />
            </Button>
          </Tooltip>

          <div className="w-6 border-b border-border my-1" />

          {VIEWS.map((v) => {
            const countVal = v.count && counts.data ? counts.data[v.count] : undefined;
            const isSelected = view === v.key;

            return (
              <Tooltip key={v.key} content={`${v.label} ${countVal ? `(${countVal})` : ""}`} side="right">
                <button
                  type="button"
                  onClick={() => setParams(v.key === "mine" ? {} : { view: v.key })}
                  className={cn(
                    "relative flex size-8 items-center justify-center rounded-lg transition-colors",
                    isSelected
                      ? "bg-primary-soft text-primary font-semibold"
                      : "text-muted hover:bg-surface-muted hover:text-foreground"
                  )}
                >
                  <v.icon className="size-4" aria-hidden />
                  {countVal !== undefined && countVal > 0 && (
                    <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white shadow-xs">
                      {countVal}
                    </span>
                  )}
                </button>
              </Tooltip>
            );
          })}
        </nav>
      )}

      {/* Conversation List Pane (Slimmed to w-72 for maximum chat canvas) */}
      <section className={cn("flex w-full shrink-0 flex-col border-r bg-surface md:w-72 lg:w-72", conversationId && "hidden md:flex")} aria-label="Conversations">
        {/* Top Search & Filter Bar */}
        <div className="space-y-2 border-b p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-subtle" aria-hidden />
            <Input className="h-8 pl-8 text-xs" placeholder="Search name, phone or message…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search conversations" />
          </div>

          {/* Quick folder pills right inside conversation list */}
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5 no-scrollbar text-xs">
            {VIEWS.slice(0, 4).map((v) => {
              const isSelected = view === v.key;
              const countVal = v.count && counts.data ? counts.data[v.count] : undefined;

              return (
                <button
                  key={v.key}
                  type="button"
                  onClick={() => setParams(v.key === "mine" ? {} : { view: v.key })}
                  className={cn(
                    "shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-colors flex items-center gap-1",
                    isSelected
                      ? "bg-primary text-white font-semibold"
                      : "bg-surface-muted/80 text-muted hover:text-foreground"
                  )}
                >
                  <span>{v.shortLabel}</span>
                  {countVal !== undefined && countVal > 0 && (
                    <span className={cn("text-[9px] font-bold px-1 rounded-full", isSelected ? "bg-white/20 text-white" : "text-muted")}>
                      {countVal}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {list.isLoading ? (
            <div className="p-3">
              <LoadingRows rows={6} />
            </div>
          ) : list.error ? (
            <div className="p-4">
              <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
            </div>
          ) : !items.length ? (
            <div className="p-4">
              <EmptyState
                icon={MessagesSquare}
                title={q ? "No matches" : view === "mine" ? "Nothing assigned to you" : "No conversations here"}
                description={
                  q ? "Try a different name, number or keyword." : view === "mine" ? "Pick one from Unassigned to start helping a customer." : "New customer messages appear here in real time."
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {items.map((c) => (
                <ConversationRow key={c.id} c={c} active={c.id === conversationId} onSelect={() => select(c.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Middle/Active Thread Pane (Expands to fill 100% of remaining width!) */}
      <section className={cn("min-w-0 flex-1 flex flex-col", conversationId ? "flex" : "hidden md:flex")} aria-label="Conversation">
        {conversationId ? (
          <ConversationView key={conversationId} conversationId={conversationId} onBack={() => navigate({ pathname: "/inbox", search: params.toString() })} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center p-8 bg-surface-muted/30">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-3">
              <MessagesSquare className="size-7" />
            </div>
            <h3 className="text-base font-semibold text-foreground">Select a conversation</h3>
            <p className="mt-1 text-xs text-muted max-w-sm text-center">
              Choose a thread from the list on the left to read messages, collaborate with notes, and reply.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
