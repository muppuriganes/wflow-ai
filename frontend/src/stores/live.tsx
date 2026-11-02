import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { getAccessToken } from "@/services/api";
import { type ChangeEvent, subscribeToChanges } from "@/services/inbox";
import { useOrganization } from "@/stores/organization";

const LiveContext = createContext(false);

/** Which cached queries each kind of change affects (keys are ["org", orgId, <name>, ...]). */
const AFFECTED: Record<string, string[]> = {
  "conversation.updated": ["inbox", "conversation", "conversations"],
  "conversation.note_added": ["notes"],
  "message.created": ["inbox", "conversation", "conversations", "messages"],
  "message.updated": ["messages"],
  "connection.updated": ["connections", "connection", "inbox"],
  "contact.updated": ["contacts", "contact", "inbox", "conversation"],
  "lead.updated": ["leads", "contact"],
  "task.updated": ["tasks", "contact"],
  "run.updated": ["runs", "run", "workflows", "workflow", "analytics"],
  "approval.updated": ["approvals"],
  "schedule.updated": ["schedules", "schedule", "runs", "workflows"],
  "template.updated": ["templates", "template"],
};

/** Keeps the current organization's data fresh by listening to server change notifications. */
export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const { current, can } = useOrganization();
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const orgId = current?.id;
  const enabled = can("inbox.read");

  useEffect(() => {
    if (!orgId || !enabled) return;
    const onEvent = (event: ChangeEvent) => {
      for (const name of AFFECTED[event.type] ?? []) {
        void queryClient.invalidateQueries({ queryKey: ["org", orgId, name] });
      }
    };
    const stop = subscribeToChanges(orgId, getAccessToken, onEvent, setConnected);
    return () => {
      stop();
      setConnected(false);
    };
  }, [orgId, enabled, queryClient]);

  return <LiveContext.Provider value={connected}>{children}</LiveContext.Provider>;
}

/** True while the change stream is open; screens can then poll much less often. */
export function useLive(): boolean {
  return useContext(LiveContext);
}

/** Polling interval: slow fallback while live updates work, faster otherwise. */
export function usePollInterval(fastMs: number): number {
  return useLive() ? 60_000 : fastMs;
}
