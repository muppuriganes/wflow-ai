import type { AckStatus, ConnectionStatus, MessageReceivedPayload } from "../events/types.js";

export type ConnectedInfo = { phone_number?: string; account_name?: string };

/** Callbacks an adapter uses to report what happened. The session manager turns them into events. */
export interface AdapterHooks {
  onQr(qr: string): void;
  onState(status: ConnectionStatus, detail?: string, info?: ConnectedInfo): void;
  onMessage(message: MessageReceivedPayload): void;
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
}

export class AdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}
