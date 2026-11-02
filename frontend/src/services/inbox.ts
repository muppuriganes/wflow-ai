import type {
  Assignee,
  ConversationStatus,
  InboxConversation,
  InboxCounts,
  InboxMessage,
  Note,
  Page,
  Priority,
  Tag,
  TagColor,
} from "@/types/api";
import { api, API_BASE_URL, ApiError, refreshSession } from "./api";

const base = (orgId: string) => `/organizations/${orgId}`;
const conv = (orgId: string, id: string) => `${base(orgId)}/conversations/${id}`;

export type InboxView = "active" | "mine" | "unassigned" | "resolved" | "archived" | "all";
export type InboxFilters = { view: InboxView; q?: string; connection_id?: string; tag_id?: string; priority?: Priority };

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  return search.toString();
}

export const inboxApi = {
  list: (orgId: string, f: InboxFilters, page = 1) =>
    api<Page<InboxConversation>>(`${base(orgId)}/conversations?${query({ ...f, page: String(page), page_size: "50" })}`),
  counts: (orgId: string) => api<InboxCounts>(`${base(orgId)}/inbox/counts`),
  assignees: (orgId: string) => api<Assignee[]>(`${base(orgId)}/inbox/assignees`),
  get: (orgId: string, id: string) => api<InboxConversation>(conv(orgId, id)),
  assign: (orgId: string, id: string, user_id: string | null) =>
    api<InboxConversation>(`${conv(orgId, id)}/assign`, { method: "POST", body: { user_id } }),
  setStatus: (orgId: string, id: string, status: ConversationStatus) =>
    api<InboxConversation>(`${conv(orgId, id)}/status`, { method: "POST", body: { status } }),
  setPriority: (orgId: string, id: string, priority: Priority) =>
    api<InboxConversation>(`${conv(orgId, id)}/priority`, { method: "POST", body: { priority } }),
  setTakeover: (orgId: string, id: string, automation_paused: boolean) =>
    api<InboxConversation>(`${conv(orgId, id)}/takeover`, { method: "POST", body: { automation_paused } }),
  messages: (orgId: string, id: string) => api<InboxMessage[]>(`${conv(orgId, id)}/messages`),
  send: (orgId: string, id: string, text: string, client_message_id: string) =>
    api<InboxMessage>(`${conv(orgId, id)}/messages`, { method: "POST", body: { text, client_message_id } }),
  sendFile: (orgId: string, id: string, file: File, caption: string, client_message_id: string) => {
    const form = new FormData();
    form.set("file", file);
    form.set("client_message_id", client_message_id);
    if (caption) form.set("caption", caption);
    return api<InboxMessage>(`${conv(orgId, id)}/attachments`, { method: "POST", form });
  },
  attachmentUrl: (orgId: string, attachmentId: string) =>
    api<{ url: string; file_name: string; content_type: string; size_bytes: number }>(
      `${base(orgId)}/attachments/${attachmentId}/url`,
    ),
  notes: (orgId: string, id: string) => api<Note[]>(`${conv(orgId, id)}/notes`),
  addNote: (orgId: string, id: string, body: string) => api<Note>(`${conv(orgId, id)}/notes`, { method: "POST", body: { body } }),

  tags: (orgId: string) => api<Tag[]>(`${base(orgId)}/tags`),
  createTag: (orgId: string, name: string, color: TagColor) =>
    api<Tag>(`${base(orgId)}/tags`, { method: "POST", body: { name, color } }),
  deleteTag: (orgId: string, tagId: string) => api<void>(`${base(orgId)}/tags/${tagId}`, { method: "DELETE" }),
  setContactTags: (orgId: string, contactId: string, tagIds: string[]) =>
    api<Tag[]>(`${base(orgId)}/contacts/${contactId}/tags`, { method: "PUT", body: tagIds }),
};

export type ChangeEvent = { type: string; conversation_id?: string; connection_id?: string; contact_id?: string; lead_id?: string; task_id?: string };

/**
 * Opens the organization's Server-Sent Events stream with fetch (EventSource cannot send the
 * Authorization header) and calls `onEvent` for each change. Reconnects with backoff and a fresh
 * token; the server closes streams when an access token would expire.
 */
export function subscribeToChanges(
  orgId: string,
  getToken: () => string | null,
  onEvent: (event: ChangeEvent) => void,
  onStatus?: (connected: boolean) => void,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let attempt = 0;

  const run = async () => {
    while (!stopped) {
      controller = new AbortController();
      try {
        let token = getToken();
        if (!token) token = (await refreshSession())?.access_token ?? null;
        const res = await fetch(`${API_BASE_URL}${base(orgId)}/events/stream`, {
          headers: { Authorization: `Bearer ${token ?? ""}`, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (res.status === 401) {
          await refreshSession();
          throw new ApiError("stream unauthorized", 401, "unauthorized");
        }
        if (!res.ok || !res.body) throw new Error(`stream failed (${res.status})`);
        attempt = 0;
        onStatus?.(true);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += value;
          let split: number;
          while ((split = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (data) {
              try {
                onEvent(JSON.parse(data) as ChangeEvent);
              } catch {
                // Malformed frame: ignore, the next change triggers a refresh anyway.
              }
            }
          }
        }
      } catch (err) {
        if (stopped || (err instanceof DOMException && err.name === "AbortError")) return;
      }
      onStatus?.(false);
      attempt += 1;
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5))));
    }
  };
  void run();
  return () => {
    stopped = true;
    controller?.abort();
  };
}
