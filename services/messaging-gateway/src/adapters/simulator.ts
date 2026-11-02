import { randomUUID } from "node:crypto";
import { AdapterError, type AdapterHooks, type ChannelAdapter, type MediaFile } from "./types.js";

// A small generated PNG (purple frame) used for simulated customer photos.
const SAMPLE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQ0lEQVR42u3XQQ0AMAgEQeTUHIJRQ01A0jRzWQHzvchTTxVAQEBAQEALoB4aEBAQEBAQEBAQEBAQkOcKBAQEBPQd6ALngWCxlnXdVgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A fake channel for development, demos and automated tests. It follows exactly the same event
 * path as WhatsApp (QR → scan → connected → messages → acks) without any external service.
 * Disabled in production.
 */
export class SimulatorAdapter implements ChannelAdapter {
  private status: "idle" | "qr" | "connected" = "idle";
  private timers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly hooks: AdapterHooks,
    private readonly connectionId: string,
    private readonly delayMs = 300,
  ) {}

  private later(fn: () => void, ms = this.delayMs): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  async start(): Promise<void> {
    this.hooks.onState("INITIALIZING");
    this.later(() => {
      this.status = "qr";
      this.hooks.onQr(`wflow-simulator:${this.connectionId}:${Date.now()}`);
    });
  }

  /** Stands in for scanning the QR code with a phone. */
  scan(): void {
    if (this.status !== "qr") throw new AdapterError("No QR code is waiting to be scanned", "invalid_state");
    this.hooks.onState("AUTHENTICATING");
    this.later(() => {
      this.status = "connected";
      this.hooks.onState("CONNECTED", undefined, { phone_number: "15550000000", account_name: "WFlow Simulator" });
    });
  }

  /** A customer sends a message to the simulated number. */
  inbound(phone: string, name: string, text: string, withImage = false): void {
    if (this.status !== "connected") throw new AdapterError("Simulator is not connected", "not_connected");
    const digits = phone.replace(/\D/g, "");
    const chatId = `${digits}@c.us`;
    this.hooks.onMessage({
      provider_message_id: `false_${chatId}_${randomUUID()}`,
      chat_id: chatId,
      sender: chatId,
      sender_name: name,
      sender_phone: digits,
      message_type: withImage ? "image" : "text",
      content: text,
      is_group: false,
      provider_timestamp: new Date().toISOString(),
    }, withImage ? { data: SAMPLE_PNG, mimetype: "image/png", filename: "photo.png" } : undefined);
  }

  async sendMedia(chatId: string, _media: MediaFile): Promise<string> {
    return this.sendText(chatId);
  }

  async sendText(chatId: string): Promise<string> {
    if (this.status !== "connected") throw new AdapterError("Channel is not connected", "not_connected");
    const id = `true_${chatId}_${randomUUID()}`;
    this.later(() => this.hooks.onAck(id, "delivered"), this.delayMs * 2);
    this.later(() => this.hooks.onAck(id, "read"), this.delayMs * 6);
    return id;
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.status = "idle";
  }

  async logout(): Promise<void> {
    await this.stop();
  }
}
