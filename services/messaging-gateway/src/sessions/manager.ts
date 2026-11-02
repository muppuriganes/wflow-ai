import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { SimulatorAdapter } from "../adapters/simulator.js";
import { AdapterError, type AdapterHooks, type ChannelAdapter } from "../adapters/types.js";
import { WhatsAppWebAdapter, type ClientFactory } from "../adapters/whatsapp-web.js";
import { buildEvent, type EventPublisher } from "../events/publisher.js";
import type { ConnectionStatus } from "../events/types.js";
import type { Logger } from "../logger.js";
import { BoundedSet, BoundedMap } from "./bounded.js";
import type { QrStore } from "./qr-store.js";

export type ChannelType = "whatsapp_web" | "simulator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus = 400,
  ) {
    super(message);
  }
}

type Session = {
  connectionId: string;
  organizationId: string;
  channelType: ChannelType;
  adapter: ChannelAdapter;
  status: ConnectionStatus;
  seenMessages: BoundedSet;
  sentByClientId: BoundedMap<string>;
  sendTimestamps: number[];
};

export type ManagerOptions = {
  sessionRoot: string;
  maxSessions: number;
  sendLimitPerMinute: number;
  qrMaxRetries: number;
  puppeteerArgs: string[];
  chromeExecutablePath?: string;
  simulatorEnabled: boolean;
  whatsappClientFactory?: ClientFactory;
};

/**
 * Owns every live channel session in this gateway process.
 * - one adapter per connection, capped by maxSessions (each WhatsApp session is a Chromium)
 * - session data namespaced per tenant: <sessionRoot>/<organization_id>/<connection_id>
 * - publishes a state event only when the status actually changes
 * - drops duplicate inbound messages and never re-sends a client_message_id it already sent
 */
export class SessionManager {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly publisher: EventPublisher,
    private readonly qrStore: QrStore,
    private readonly opts: ManagerOptions,
    private readonly log: Logger,
  ) {}

  list(): { connection_id: string; organization_id: string; channel_type: ChannelType; status: ConnectionStatus }[] {
    return [...this.sessions.values()].map((s) => ({
      connection_id: s.connectionId,
      organization_id: s.organizationId,
      channel_type: s.channelType,
      status: s.status,
    }));
  }

  get size(): number {
    return this.sessions.size;
  }

  /**
   * <root>/<hash(org)>/<hash(org:connection)>, 16 hex chars each. Still one folder per tenant, but
   * compact: Chromium's profile (service-worker caches) nests ~110 characters deep, and with two full
   * UUIDs the paths pass Windows' 260-character limit, which makes WhatsApp Web reload mid-startup
   * ("Execution context was destroyed").
   */
  sessionDir(organizationId: string, connectionId: string): string {
    // Ids are validated as UUIDs, so nothing user-controlled reaches the filesystem path.
    if (!UUID.test(organizationId) || !UUID.test(connectionId)) throw new SessionError("Invalid identifier", "invalid_id");
    const short = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
    return path.resolve(this.opts.sessionRoot, short(organizationId), short(`${organizationId}:${connectionId}`));
  }

  private get(connectionId: string, organizationId?: string): Session {
    const session = this.sessions.get(connectionId);
    // A mismatched organization is reported exactly like a missing session.
    if (!session || (organizationId && session.organizationId !== organizationId)) {
      throw new SessionError("No active session for this connection", "session_not_found", 404);
    }
    return session;
  }

  /**
   * @param fresh true for a new QR link (never connected, or after logout). The stored browser
   *   profile is wiped first: a half-initialised profile from an abandoned attempt otherwise makes
   *   WhatsApp Web fail on every later start. Resumed sessions (fresh=false) keep their login.
   */
  async start(connectionId: string, organizationId: string, channelType: ChannelType, fresh = false): Promise<void> {
    const sessionDir = this.sessionDir(organizationId, connectionId);
    const existing = this.sessions.get(connectionId);
    if (existing) {
      if (existing.organizationId !== organizationId) throw new SessionError("Connection belongs to another organization", "forbidden", 403);
      if (existing.status !== "ERROR" && existing.status !== "DISCONNECTED" && existing.status !== "LOGGED_OUT") return;
      await this.stop(connectionId);
    }
    if (this.sessions.size >= this.opts.maxSessions) {
      throw new SessionError("The messaging service is at capacity. Try again later.", "capacity", 503);
    }
    if (channelType === "simulator" && !this.opts.simulatorEnabled) {
      throw new SessionError("Simulator is disabled", "channel_unavailable");
    }
    if (fresh) await rm(sessionDir, { recursive: true, force: true, maxRetries: 3 });

    const session = {
      connectionId,
      organizationId,
      channelType,
      status: "NOT_CONNECTED",
      seenMessages: new BoundedSet(5000),
      sentByClientId: new BoundedMap<string>(5000),
      sendTimestamps: [],
    } as unknown as Session;
    const hooks = this.hooksFor(session);
    session.adapter =
      channelType === "simulator"
        ? new SimulatorAdapter(hooks, connectionId)
        : new WhatsAppWebAdapter(
            hooks,
            {
              sessionDir,
              qrMaxRetries: this.opts.qrMaxRetries,
              puppeteerArgs: this.opts.puppeteerArgs,
              executablePath: this.opts.chromeExecutablePath,
            },
            this.log.child({ connectionId }),
            this.opts.whatsappClientFactory,
          );
    this.sessions.set(connectionId, session);
    this.log.info({ connectionId, organizationId, channelType }, "session_starting");
    await session.adapter.start();
  }

  private hooksFor(session: Session): AdapterHooks {
    const emit = (body: Parameters<typeof buildEvent>[2]) =>
      this.publisher
        .publish(buildEvent(session.organizationId, session.connectionId, body))
        .catch((err: unknown) => this.log.error({ err: String(err), connectionId: session.connectionId }, "publish_failed"));

    return {
      onQr: (qr) => {
        void this.qrStore
          .put(session.connectionId, qr)
          .catch((err: unknown) => this.log.error({ err: String(err) }, "qr_store_failed"));
        this.setState(session, "QR_PENDING", emit);
      },
      onState: (status, detail, info) => {
        if (status !== "QR_PENDING") void this.qrStore.clear(session.connectionId).catch(() => undefined);
        this.setState(session, status, emit, detail, info);
        if (status === "LOGGED_OUT") void this.wipe(session).catch(() => undefined);
        if (status === "LOGGED_OUT" || status === "DISCONNECTED" || status === "ERROR") {
          // The adapter has already closed its client; forget the session so it can be restarted.
          if (this.sessions.get(session.connectionId) === session) this.sessions.delete(session.connectionId);
        }
      },
      onMessage: (message) => {
        if (session.seenMessages.has(message.provider_message_id)) return;
        session.seenMessages.add(message.provider_message_id);
        void emit({ event_type: "message.received", payload: message });
      },
      onAck: (providerMessageId, status) => {
        void emit({ event_type: "message.ack", payload: { provider_message_id: providerMessageId, status } });
      },
    };
  }

  private setState(
    session: Session,
    status: ConnectionStatus,
    emit: (body: Parameters<typeof buildEvent>[2]) => Promise<void>,
    detail?: string,
    info?: { phone_number?: string; account_name?: string },
  ): void {
    if (session.status === status && status !== "ERROR") return;
    session.status = status;
    this.log.info({ connectionId: session.connectionId, status }, "session_state");
    void emit({ event_type: "connection.state", payload: { status, detail, ...info } });
  }

  async sendText(
    connectionId: string,
    organizationId: string,
    chatId: string,
    text: string,
    clientMessageId: string,
  ): Promise<string> {
    const session = this.get(connectionId, organizationId);
    const already = session.sentByClientId.get(clientMessageId);
    if (already) return already; // retried request: do not send twice

    const now = Date.now();
    session.sendTimestamps = session.sendTimestamps.filter((t) => now - t < 60_000);
    if (session.sendTimestamps.length >= this.opts.sendLimitPerMinute) {
      throw new SessionError("Sending limit reached for this connection. Try again in a minute.", "rate_limited", 429);
    }
    session.sendTimestamps.push(now);

    let providerId: string;
    try {
      providerId = await session.adapter.sendText(chatId, text);
    } catch (err) {
      if (err instanceof AdapterError) throw new SessionError(err.message, err.code, 409);
      throw err;
    }
    session.sentByClientId.set(clientMessageId, providerId);
    await this.publisher
      .publish(
        buildEvent(organizationId, connectionId, {
          event_type: "message.sent",
          payload: { provider_message_id: providerId, client_message_id: clientMessageId },
        }),
      )
      .catch((err: unknown) => this.log.error({ err: String(err) }, "publish_failed"));
    return providerId;
  }

  async stop(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) return;
    this.sessions.delete(connectionId);
    await session.adapter.stop();
    await this.qrStore.clear(connectionId).catch(() => undefined);
  }

  async logout(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (!session) return;
    this.sessions.delete(connectionId);
    await session.adapter.logout();
    await this.qrStore.clear(connectionId).catch(() => undefined);
    await this.wipe(session);
    await this.publisher
      .publish(
        buildEvent(session.organizationId, connectionId, {
          event_type: "connection.state",
          payload: { status: "LOGGED_OUT", detail: "Logged out by a team member" },
        }),
      )
      .catch(() => undefined);
  }

  /** Logout (if running) and securely delete all stored session data for the connection. */
  async remove(connectionId: string, organizationId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session && session.organizationId !== organizationId) throw new SessionError("Not found", "session_not_found", 404);
    if (session) {
      this.sessions.delete(connectionId);
      await session.adapter.logout();
    }
    await this.qrStore.clear(connectionId).catch(() => undefined);
    await rm(this.sessionDir(organizationId, connectionId), { recursive: true, force: true, maxRetries: 3 });
    this.log.info({ connectionId }, "session_removed");
  }

  simulator(connectionId: string): SimulatorAdapter {
    const session = this.get(connectionId);
    if (!(session.adapter instanceof SimulatorAdapter)) throw new SessionError("Not a simulator connection", "not_simulator");
    return session.adapter;
  }

  /** Graceful shutdown: close browsers but keep credentials so sessions resume after restart. */
  async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(
      sessions.map(async (s) => {
        await s.adapter.stop();
        await this.publisher
          .publish(
            buildEvent(s.organizationId, s.connectionId, {
              event_type: "connection.state",
              payload: { status: "DISCONNECTED", detail: "Messaging service restarting" },
            }),
          )
          .catch(() => undefined);
      }),
    );
  }

  private async wipe(session: Session): Promise<void> {
    await rm(this.sessionDir(session.organizationId, session.connectionId), { recursive: true, force: true, maxRetries: 3 });
  }
}
