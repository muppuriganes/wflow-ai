import { EventEmitter } from "node:events";
import wweb from "whatsapp-web.js";
import type { Logger } from "../logger.js";
import { isCustomerMessage, mapAck, normalizeMessage, type RawMessage } from "./normalize.js";
import { AdapterError, type AdapterHooks, type ChannelAdapter, MAX_MEDIA_BYTES, type MediaFile } from "./types.js";

type WAMessage = RawMessage & {
  getContact?: () => Promise<{ pushname?: string; name?: string; number?: string }>;
  downloadMedia?: () => Promise<{ mimetype: string; data: string; filename?: string | null } | undefined>;
};

/** The parts of whatsapp-web.js `Client` this adapter uses; tests supply a fake. */
export interface WAClient extends EventEmitter {
  info?: { wid?: { user?: string }; pushname?: string };
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;
  sendMessage(
    chatId: string,
    content: unknown,
    options?: { caption?: string; sendMediaAsDocument?: boolean },
  ): Promise<{ id: { _serialized: string } }>;
}

export type ClientOptions = { sessionDir: string; qrMaxRetries: number; puppeteerArgs: string[]; executablePath?: string };
export type ClientFactory = (opts: ClientOptions) => WAClient;

export const createWhatsAppClient: ClientFactory = ({ sessionDir, qrMaxRetries, puppeteerArgs, executablePath }) =>
  new wweb.Client({
    authStrategy: new wweb.LocalAuth({ dataPath: sessionDir }),
    qrMaxRetries,
    puppeteer: { headless: true, args: puppeteerArgs, ...(executablePath ? { executablePath } : {}) },
  }) as unknown as WAClient;

/**
 * WhatsApp Web via whatsapp-web.js (unofficial; see docs/WHATSAPP_CONNECTOR.md).
 * Uses only documented client events and methods. No reconnection tricks or detection evasion:
 * when the session drops, it reports DISCONNECTED and waits for a person to reconnect.
 */
export class WhatsAppWebAdapter implements ChannelAdapter {
  private client: WAClient | null = null;
  private connected = false;

  constructor(
    private readonly hooks: AdapterHooks,
    private readonly opts: ClientOptions,
    private readonly log: Logger,
    private readonly factory: ClientFactory = createWhatsAppClient,
  ) {}

  async start(): Promise<void> {
    if (this.client) return;
    const client = this.factory(this.opts);
    this.client = client;
    this.wire(client);
    this.hooks.onState("INITIALIZING");
    // initialize() resolves only after authentication completes, so it is not awaited here:
    // progress arrives through events, and launch failures through the catch.
    client.initialize().catch((err: unknown) => {
      if (this.client !== client) return; // stopped meanwhile
      this.log.error({ err: String(err) }, "whatsapp_initialize_failed");
      this.client = null;
      this.hooks.onState("ERROR", `Could not start WhatsApp Web: ${String(err).slice(0, 200)}`);
      void client.destroy().catch(() => undefined);
    });
  }

  private wire(client: WAClient): void {
    client.on("qr", (qr: string) => this.hooks.onQr(qr));
    client.on("authenticated", () => this.hooks.onState("AUTHENTICATING"));
    client.on("auth_failure", (message: string) => {
      this.connected = false;
      this.hooks.onState("ERROR", `Authentication failed: ${message}`.slice(0, 300));
    });
    client.on("ready", () => {
      this.connected = true;
      this.hooks.onState("CONNECTED", undefined, {
        phone_number: client.info?.wid?.user,
        account_name: client.info?.pushname,
      });
    });
    client.on("disconnected", (reason: string) => {
      this.connected = false;
      if (this.client === client) this.client = null;
      if (reason === "LOGOUT") {
        this.hooks.onState("LOGGED_OUT", "Logged out from the phone");
      } else if (/qr/i.test(reason)) {
        this.hooks.onState("ERROR", "QR code was not scanned in time. Start the connection again.");
      } else {
        this.hooks.onState("DISCONNECTED", `Disconnected: ${reason}`.slice(0, 300));
      }
      void client.destroy().catch(() => undefined);
    });
    const handleInbound = (msg: WAMessage) => {
      this.log.info({ from: msg.from, fromMe: msg.fromMe, type: msg.type, body: msg.body }, "raw_whatsapp_message");
      if (!isCustomerMessage(msg)) return;
      void (async () => {
        let contact: { name?: string; phone?: string } | undefined;
        try {
          const c = await msg.getContact?.();
          if (c) contact = { name: c.pushname || c.name, phone: c.number };
        } catch {
          // Contact lookup is best-effort; the sender id is still recorded.
        }
        this.hooks.onMessage(normalizeMessage(msg, contact), await this.download(msg));
      })();
    };

    client.on("message", handleInbound);
    client.on("message_create", handleInbound);
    client.on("message_ack", (msg: RawMessage, ack: number) => {
      const status = mapAck(ack);
      if (msg.fromMe && status) this.hooks.onAck(msg.id._serialized, status);
    });
  }

  /** Media is fetched from WhatsApp only for customer messages; failures keep the message without the file. */
  private async download(msg: WAMessage): Promise<MediaFile | undefined> {
    if (!msg.hasMedia || !msg.downloadMedia) return undefined;
    try {
      const media = await msg.downloadMedia();
      if (!media?.data) return undefined;
      const data = Buffer.from(media.data, "base64");
      if (data.length > MAX_MEDIA_BYTES) {
        this.log.warn({ size: data.length }, "inbound_media_too_large");
        return undefined;
      }
      return { data, mimetype: media.mimetype, filename: media.filename ?? undefined };
    } catch (err) {
      this.log.warn({ err: String(err) }, "inbound_media_download_failed");
      return undefined;
    }
  }

  async sendMedia(chatId: string, media: MediaFile, caption?: string): Promise<string> {
    if (!this.client || !this.connected) throw new AdapterError("Channel is not connected", "not_connected");
    const payload = new wweb.MessageMedia(media.mimetype, media.data.toString("base64"), media.filename ?? null, media.data.length);
    const asDocument = !/^(image|video|audio)\//.test(media.mimetype);
    try {
      const sent = await this.client.sendMessage(chatId, payload, { caption: caption || undefined, sendMediaAsDocument: asDocument });
      return sent.id._serialized;
    } catch (err) {
      throw new AdapterError(`WhatsApp rejected the file: ${String(err).slice(0, 200)}`, "send_failed");
    }
  }

  async sendText(chatId: string, text: string): Promise<string> {
    if (!this.client || !this.connected) throw new AdapterError("Channel is not connected", "not_connected");
    try {
      const sent = await this.client.sendMessage(chatId, text);
      return sent.id._serialized;
    } catch (err) {
      throw new AdapterError(`WhatsApp rejected the message: ${String(err).slice(0, 200)}`, "send_failed");
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (client) await client.destroy().catch((err: unknown) => this.log.warn({ err: String(err) }, "destroy_failed"));
  }

  async logout(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connected = false;
    if (!client) return;
    try {
      await client.logout(); // unlinks the device; LocalAuth removes its session files
    } catch (err) {
      this.log.warn({ err: String(err) }, "logout_failed");
    }
    await client.destroy().catch(() => undefined);
  }
}
