import { EventEmitter } from "node:events";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import type { WAClient } from "../adapters/whatsapp-web.js";
import { MemoryPublisher } from "../events/publisher.js";
import type { ChannelEvent } from "../events/types.js";
import { SessionManager } from "./manager.js";
import { MemoryMediaUploader } from "./media.js";
import { MemoryQrStore } from "./qr-store.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const CONN = "33333333-3333-4333-8333-333333333333";

class FakeClient extends EventEmitter implements WAClient {
  info = { wid: { user: "14155550100" }, pushname: "Acme Support" };
  initializeError: Error | null = null;
  destroyed = false;
  loggedOut = false;
  sent: { chatId: string; text: string }[] = [];
  async initialize() {
    if (this.initializeError) throw this.initializeError;
  }
  async destroy() {
    this.destroyed = true;
  }
  async logout() {
    this.loggedOut = true;
  }
  async sendMessage(chatId: string, text: string) {
    this.sent.push({ chatId, text });
    return { id: { _serialized: `true_${chatId}_${this.sent.length}` } };
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const states = (events: ChannelEvent[]) =>
  events.filter((e) => e.event_type === "connection.state").map((e) => (e.payload as { status: string }).status);

describe("SessionManager with WhatsApp Web adapter", () => {
  let publisher: MemoryPublisher;
  let qr: MemoryQrStore;
  let client: FakeClient;
  let manager: SessionManager;
  let root: string;

  beforeEach(async () => {
    publisher = new MemoryPublisher();
    qr = new MemoryQrStore();
    client = new FakeClient();
    root = path.join(os.tmpdir(), `wflow-gw-${Date.now()}-${Math.random()}`);
    manager = new SessionManager(
      publisher,
      qr,
      {
        sessionRoot: root,
        maxSessions: 2,
        sendLimitPerMinute: 2,
        qrMaxRetries: 3,
        puppeteerArgs: [],
        simulatorEnabled: true,
        whatsappClientFactory: () => client,
      },
      pino({ level: "silent" }),
    );
  });

  it("walks the QR lifecycle and reports each state once", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("qr", "qr-1");
    client.emit("qr", "qr-2"); // refreshed QR: stored, but no duplicate state event
    await tick();
    expect(qr.codes.get(CONN)).toBe("qr-2");
    client.emit("authenticated");
    client.emit("ready");
    await tick();
    expect(states(publisher.events)).toEqual(["INITIALIZING", "QR_PENDING", "AUTHENTICATING", "CONNECTED"]);
    expect(qr.codes.has(CONN)).toBe(false); // QR cleared once authenticated
    const connected = publisher.events.at(-1)!;
    expect(connected.payload).toMatchObject({ phone_number: "14155550100", account_name: "Acme Support" });
    expect(connected.organization_id).toBe(ORG);
  });

  it("reports browser start failures as ERROR and frees the slot", async () => {
    client.initializeError = new Error("Failed to launch the browser process");
    await manager.start(CONN, ORG, "whatsapp_web");
    await tick();
    expect(states(publisher.events)).toEqual(["INITIALIZING", "ERROR"]);
    expect(manager.size).toBe(0);
  });

  it("maps disconnect reasons: QR timeout, network drop, phone logout (wipes session)", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("disconnected", "Max qrcode retries reached");
    await tick();
    expect(states(publisher.events).at(-1)).toBe("ERROR");

    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    client.emit("disconnected", "NAVIGATION");
    await tick();
    expect(states(publisher.events).at(-1)).toBe("DISCONNECTED");

    const dir = manager.sessionDir(ORG, CONN);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "session.json"), "{}");
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    client.emit("disconnected", "LOGOUT");
    await new Promise((r) => setTimeout(r, 50));
    expect(states(publisher.events).at(-1)).toBe("LOGGED_OUT");
    await expect(readdir(dir)).rejects.toThrow(); // session data removed
  });

  it("emits customer messages once and ignores own/status messages", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    const msg = {
      id: { _serialized: "false_919800000001@c.us_ABC" },
      from: "919800000001@c.us",
      body: "Hello",
      type: "chat",
      timestamp: 1_790_000_000,
      fromMe: false,
      isStatus: false,
      getContact: async () => ({ pushname: "Ravi", number: "919800000001" }),
    };
    client.emit("message", msg);
    client.emit("message", msg);
    client.emit("message", { ...msg, id: { _serialized: "x" }, fromMe: true });
    client.emit("message", { ...msg, id: { _serialized: "y" }, from: "status@broadcast", isStatus: true });
    await new Promise((r) => setTimeout(r, 10));
    const received = publisher.events.filter((e) => e.event_type === "message.received");
    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toMatchObject({
      chat_id: "919800000001@c.us",
      sender_name: "Ravi",
      sender_phone: "919800000001",
      message_type: "text",
      content: "Hello",
      is_group: false,
    });
  });

  it("sends idempotently per client_message_id, rate limits, and reports acks", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    const a = await manager.sendText(CONN, ORG, "919800000001@c.us", "Hi", "client-0001");
    const again = await manager.sendText(CONN, ORG, "919800000001@c.us", "Hi", "client-0001");
    expect(again).toBe(a);
    expect(client.sent).toHaveLength(1);
    await manager.sendText(CONN, ORG, "919800000001@c.us", "Second", "client-0002");
    await expect(manager.sendText(CONN, ORG, "919800000001@c.us", "Third", "client-0003")).rejects.toMatchObject({
      code: "rate_limited",
      httpStatus: 429,
    });

    client.emit("message_ack", { id: { _serialized: a }, fromMe: true }, 3);
    client.emit("message_ack", { id: { _serialized: a }, fromMe: true }, 0); // pending: not reported
    await tick();
    const acks = publisher.events.filter((e) => e.event_type === "message.ack").map((e) => e.payload);
    expect(acks).toEqual([{ provider_message_id: a, status: "read" }]);
    expect(publisher.events.some((e) => e.event_type === "message.sent")).toBe(true);
  });

  it("refuses to send before the session is connected", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    await expect(manager.sendText(CONN, ORG, "1@c.us", "Hi", "client-0001")).rejects.toMatchObject({ code: "not_connected" });
  });

  it("isolates tenants and rejects path traversal", async () => {
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    await expect(manager.sendText(CONN, OTHER_ORG, "1@c.us", "Hi", "client-0001")).rejects.toMatchObject({ httpStatus: 404 });
    await expect(manager.start(CONN, OTHER_ORG, "whatsapp_web")).rejects.toMatchObject({ httpStatus: 403 });
    expect(() => manager.sessionDir("../../etc", CONN)).toThrow("Invalid identifier");
  });

  it("enforces the session cap", async () => {
    await manager.start(CONN, ORG, "simulator");
    await manager.start("44444444-4444-4444-8444-444444444444", ORG, "simulator");
    await expect(manager.start("55555555-5555-4555-8555-555555555555", ORG, "simulator")).rejects.toMatchObject({
      code: "capacity",
    });
  });

  it("remove logs out and deletes stored session data", async () => {
    const dir = manager.sessionDir(ORG, CONN);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "creds"), "secret");
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    await manager.remove(CONN, ORG);
    expect(client.loggedOut).toBe(true);
    await expect(readdir(dir)).rejects.toThrow();
    expect(manager.size).toBe(0);
  });
});

describe("Simulator through the manager", () => {
  it("scan → connected → inbound → send with acks", async () => {
    const publisher = new MemoryPublisher();
    const manager = new SessionManager(
      publisher,
      new MemoryQrStore(),
      { sessionRoot: os.tmpdir(), maxSessions: 5, sendLimitPerMinute: 10, qrMaxRetries: 3, puppeteerArgs: [], simulatorEnabled: true },
      pino({ level: "silent" }),
    );
    await manager.start(CONN, ORG, "simulator");
    await new Promise((r) => setTimeout(r, 350));
    manager.simulator(CONN).scan();
    await new Promise((r) => setTimeout(r, 350));
    manager.simulator(CONN).inbound("+91 98000 00001".replace(/\s/g, ""), "Ravi", "Hi");
    const id = await manager.sendText(CONN, ORG, "919800000001@c.us", "Hello Ravi", "client-0001");
    await new Promise((r) => setTimeout(r, 2000));
    expect(states(publisher.events)).toEqual(["INITIALIZING", "QR_PENDING", "AUTHENTICATING", "CONNECTED"]);
    const acks = publisher.events.filter((e) => e.event_type === "message.ack").map((e) => (e.payload as { status: string }).status);
    expect(acks).toEqual(["delivered", "read"]);
    expect(id).toMatch(/^true_919800000001@c\.us_/);
    await manager.shutdown();
  });
});

describe("fresh starts", () => {
  it("wipe a stale browser profile, while resumed sessions keep it", async () => {
    const root = path.join(os.tmpdir(), `wflow-gw-fresh-${Date.now()}`);
    const manager = new SessionManager(
      new MemoryPublisher(),
      new MemoryQrStore(),
      { sessionRoot: root, maxSessions: 5, sendLimitPerMinute: 10, qrMaxRetries: 3, puppeteerArgs: [], simulatorEnabled: true, whatsappClientFactory: () => new FakeClient() },
      pino({ level: "silent" }),
    );
    const dir = manager.sessionDir(ORG, CONN);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "stale"), "x");
    await manager.start(CONN, ORG, "whatsapp_web", false);
    expect(await readdir(dir)).toEqual(["stale"]);
    await manager.stop(CONN);
    await manager.start(CONN, ORG, "whatsapp_web", true);
    await expect(readdir(dir)).rejects.toThrow();
  });
});

describe("sessionDir", () => {
  it("is compact, deterministic and different per tenant", () => {
    const m = new SessionManager(new MemoryPublisher(), new MemoryQrStore(), { sessionRoot: "/data/s", maxSessions: 1, sendLimitPerMinute: 1, qrMaxRetries: 1, puppeteerArgs: [], simulatorEnabled: false }, pino({ level: "silent" }));
    const a = m.sessionDir(ORG, CONN);
    expect(a).toBe(m.sessionDir(ORG, CONN));
    const parts = path.relative(path.resolve("/data/s"), a).split(path.sep);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).toMatch(/^[0-9a-f]{16}$/);
    expect(m.sessionDir(OTHER_ORG, CONN)).not.toBe(a);
  });
});

describe("media", () => {
  const setup = (uploader: MemoryMediaUploader) => {
    const publisher = new MemoryPublisher();
    const client = new FakeClient();
    const manager = new SessionManager(
      publisher,
      new MemoryQrStore(),
      { sessionRoot: os.tmpdir(), maxSessions: 5, sendLimitPerMinute: 10, qrMaxRetries: 3, puppeteerArgs: [], simulatorEnabled: true, whatsappClientFactory: () => client, mediaUploader: uploader },
      pino({ level: "silent" }),
    );
    return { publisher, client, manager };
  };
  const photo = {
    id: { _serialized: "false_1@c.us_PHOTO" }, from: "919800000001@c.us", body: "my receipt", type: "image",
    timestamp: 1_790_000_000, fromMe: false, isStatus: false, hasMedia: true,
    downloadMedia: async () => ({ mimetype: "image/png", data: Buffer.from("png-bytes").toString("base64"), filename: "r.png" }),
  };

  it("uploads inbound media before announcing the message", async () => {
    const uploader = new MemoryMediaUploader();
    const { publisher, client, manager } = setup(uploader);
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    client.emit("message", photo);
    await new Promise((r) => setTimeout(r, 20));
    expect(uploader.uploads).toHaveLength(1);
    expect(uploader.uploads[0]!.media.data.toString()).toBe("png-bytes");
    const received = publisher.events.find((e) => e.event_type === "message.received")!;
    expect(received.payload).toMatchObject({ message_type: "image", content: "my receipt", attachment: { attachment_id: expect.any(String) } });
  });

  it("still delivers the message when the upload fails", async () => {
    const uploader = new MemoryMediaUploader();
    uploader.fail = true;
    const { publisher, client, manager } = setup(uploader);
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    client.emit("message", photo);
    await new Promise((r) => setTimeout(r, 20));
    const received = publisher.events.find((e) => e.event_type === "message.received")!;
    expect(received.payload).not.toHaveProperty("attachment");
  });

  it("rejects non-http media URLs and reports them as unavailable", async () => {
    const { client, manager } = setup(new MemoryMediaUploader());
    await manager.start(CONN, ORG, "whatsapp_web");
    client.emit("ready");
    await expect(
      manager.sendMedia(CONN, ORG, "1@c.us", { url: "file:///etc/passwd", contentType: "image/png", fileName: "x.png" }, "client-0009"),
    ).rejects.toMatchObject({ code: "media_unavailable" });
    expect(client.sent).toHaveLength(0);
  });

  it("simulator: inbound photo goes through the uploader with a real PNG", async () => {
    const uploader = new MemoryMediaUploader();
    const { manager } = setup(uploader);
    await manager.start(CONN, ORG, "simulator");
    await new Promise((r) => setTimeout(r, 350));
    manager.simulator(CONN).scan();
    await new Promise((r) => setTimeout(r, 350));
    manager.simulator(CONN).inbound("919800000001", "Ravi", "photo", true);
    await new Promise((r) => setTimeout(r, 20));
    expect(uploader.uploads[0]!.media.data.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    await manager.shutdown();
  });
});
