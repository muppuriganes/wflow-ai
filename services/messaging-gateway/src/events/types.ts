/**
 * Normalized channel events — the contract between the gateway and the backend.
 * Mirrors backend/app/schemas/channel_events.py. Any channel adapter must produce exactly these.
 */

export const CONNECTION_STATUSES = [
  "NOT_CONNECTED",
  "INITIALIZING",
  "QR_PENDING",
  "AUTHENTICATING",
  "CONNECTED",
  "DISCONNECTED",
  "RECONNECTING",
  "ERROR",
  "LOGGED_OUT",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type AckStatus = "sent" | "delivered" | "read" | "played" | "failed";

export type ConnectionStatePayload = {
  status: ConnectionStatus;
  detail?: string;
  phone_number?: string;
  account_name?: string;
};

export type MessageReceivedPayload = {
  provider_message_id: string;
  chat_id: string;
  sender: string;
  sender_name?: string;
  sender_phone?: string;
  /** text | image | video | audio | document | sticker | location | contact | unsupported */
  message_type: string;
  content?: string;
  is_group: boolean;
  provider_timestamp?: string;
};

export type MessageSentPayload = { provider_message_id: string; client_message_id: string };
export type MessageAckPayload = { provider_message_id: string; status: AckStatus };

type Envelope<T extends string, P> = {
  event_id: string;
  organization_id: string;
  connection_id: string;
  occurred_at: string;
  event_type: T;
  payload: P;
};

export type ChannelEvent =
  | Envelope<"connection.state", ConnectionStatePayload>
  | Envelope<"message.received", MessageReceivedPayload>
  | Envelope<"message.sent", MessageSentPayload>
  | Envelope<"message.ack", MessageAckPayload>;
