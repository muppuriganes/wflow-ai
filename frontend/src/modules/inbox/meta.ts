import type { BadgeTone } from "@/components/ui/badge";
import type { ConversationStatus, Priority } from "@/types/api";

export const STATUS_LABELS: Record<ConversationStatus, { label: string; tone: BadgeTone }> = {
  OPEN: { label: "Open", tone: "info" },
  PENDING: { label: "Pending", tone: "warning" },
  ASSIGNED: { label: "Assigned", tone: "primary" },
  RESOLVED: { label: "Resolved", tone: "success" },
  ARCHIVED: { label: "Archived", tone: "neutral" },
};

export const PRIORITY_LABELS: Record<Priority, { label: string; tone: BadgeTone }> = {
  low: { label: "Low", tone: "neutral" },
  normal: { label: "Normal", tone: "neutral" },
  high: { label: "High", tone: "warning" },
  urgent: { label: "Urgent", tone: "danger" },
};

export function contactName(c: { display_name: string | null; phone_number: string | null }): string {
  return c.display_name || (c.phone_number ? `+${c.phone_number}` : "Unknown");
}

export function initials(name: string): string {
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
}

/** Client-side idempotency key for sends (letters/digits only, as the API requires). */
export function newClientId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
