import type { BadgeTone } from "@/components/ui/badge";
import type { ChannelType, ConnectionStatus } from "@/types/api";

export const STATUS_META: Record<ConnectionStatus, { label: string; tone: BadgeTone }> = {
  NOT_CONNECTED: { label: "Not connected", tone: "neutral" },
  INITIALIZING: { label: "Starting", tone: "info" },
  QR_PENDING: { label: "Waiting for scan", tone: "info" },
  AUTHENTICATING: { label: "Authenticating", tone: "info" },
  CONNECTED: { label: "Connected", tone: "success" },
  DISCONNECTED: { label: "Disconnected", tone: "warning" },
  RECONNECTING: { label: "Reconnecting", tone: "info" },
  ERROR: { label: "Error", tone: "danger" },
  LOGGED_OUT: { label: "Logged out", tone: "neutral" },
};

/** States that change on their own within seconds; the UI polls faster while in them. */
export const TRANSITIONAL: ReadonlySet<ConnectionStatus> = new Set([
  "INITIALIZING",
  "QR_PENDING",
  "AUTHENTICATING",
  "RECONNECTING",
]);

export const CAN_START: ReadonlySet<ConnectionStatus> = new Set(["NOT_CONNECTED", "DISCONNECTED", "ERROR", "LOGGED_OUT"]);

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  whatsapp_web: "WhatsApp (QR link)",
  simulator: "Simulator (testing)",
};

export function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  return phone.startsWith("+") ? phone : `+${phone}`;
}
