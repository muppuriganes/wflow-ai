import type { AckStatus, ConnectionStatus, MessageReceivedPayload } from "../events/types.js";

export type ConnectedInfo = { phone_number?: string; account_name?: string };

/** A file attached to a message, as raw bytes. */
export type MediaFile = { data: Buffer; mimetype: string; filename?: string };

/** WhatsApp's media limit; larger inbound files are reported without the file. */
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024;

/** Callbacks an adapter uses to report what happened. The session manager turns them into events. */
export interface AdapterHooks {
  onQr(qr: string): void;
  onState(status: ConnectionStatus, detail?: string, info?: ConnectedInfo): void;
  onMessage(message: MessageReceivedPayload, media?: MediaFile): void;
  onAck(providerMessageId: string, status: AckStatus): void;
}

/** One live channel session. Implementations: WhatsApp Web (whatsapp-web.js) and the simulator. */
export interface ChannelAdapter {
  start(): Promise<void>;
  /** Close the session but keep stored credentials (it can be resumed). */
  stop(): Promise<void>;
  /** Unlink the device and delete stored credentials. */
  logout(): Promise<void>;
  sendText(chatId: string, text: string): Promise<string>;
  sendMedia(chatId: string, media: MediaFile, caption?: string): Promise<string>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
