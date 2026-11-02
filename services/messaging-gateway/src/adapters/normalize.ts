import type { AckStatus, MessageReceivedPayload } from "../events/types.js";

/** whatsapp-web.js MessageTypes → our provider-neutral message types. */
const TYPE_MAP: Record<string, string> = {
  chat: "text",
  image: "image",
  video: "video",
  audio: "audio",
  ptt: "audio",
  document: "document",
  sticker: "sticker",
  location: "location",
  vcard: "contact",
  multi_vcard: "contact",
};

/** MessageAck values from whatsapp-web.js. PENDING (0) is not reported: nothing has happened yet. */
export function mapAck(ack: number): AckStatus | null {
  switch (ack) {
    case -1:
      return "failed";
    case 1:
      return "sent";
    case 2:
      return "delivered";
    case 3:
      return "read";
    case 4:
      return "played";
    default:
      return null;
  }
}

/** The subset of a whatsapp-web.js Message we rely on (keeps tests free of the real library). */
export type RawMessage = {
  id: { _serialized: string };
  from: string;
  author?: string;
  body: string;
  type: string;
  timestamp: number;
  fromMe: boolean;
  isStatus: boolean;
};

export function normalizeMessage(
  msg: RawMessage,
  contact?: { name?: string; phone?: string },
): MessageReceivedPayload {
  const isGroup = msg.from.endsWith("@g.us");
  const sender = (isGroup ? msg.author : msg.from) ?? msg.from;
  const messageType = TYPE_MAP[msg.type] ?? "unsupported";
  const content = msg.body?.trim() ? msg.body : undefined; // for media this is the caption
  return {
    provider_message_id: msg.id._serialized,
    chat_id: msg.from,
    sender,
    sender_name: contact?.name || undefined,
    sender_phone: contact?.phone || sender.split("@")[0]?.replace(/\D/g, "") || undefined,
    message_type: messageType,
    content,
    is_group: isGroup,
    provider_timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : undefined,
  };
}

/** Status broadcasts and our own outgoing messages are not customer messages. */
export function isCustomerMessage(msg: RawMessage): boolean {
  return !msg.fromMe && !msg.isStatus && msg.from !== "status@broadcast";
}
