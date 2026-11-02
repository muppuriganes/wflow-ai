import os from "node:os";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { MemoryPublisher } from "../events/publisher.js";
import { SessionManager } from "../sessions/manager.js";
import { MemoryQrStore } from "../sessions/qr-store.js";
import { buildServer } from "./server.js";

const TOKEN = "t".repeat(40);
const ORG = "11111111-1111-4111-8111-111111111111";
const CONN = "33333333-3333-4333-8333-333333333333";

function setup(simulatorEnabled = true) {
  const logger = pino({ level: "silent" });
  const manager = new SessionManager(
    new MemoryPublisher(),
    new MemoryQrStore(),
    { sessionRoot: os.tmpdir(), maxSessions: 5, sendLimitPerMinute: 10, qrMaxRetries: 3, puppeteerArgs: [], simulatorEnabled },
    logger,
  );
  return { app: buildServer(manager, { token: TOKEN, simulatorEnabled, logger }), manager };
}

const auth = { authorization: `Bearer ${TOKEN}` };

describe("gateway HTTP API", () => {
  it("requires the internal token except for /health", async () => {
    const { app } = setup();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/v1/connections" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/connections", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/connections", headers: auth })).statusCode).toBe(200);
  });

  it("validates input", async () => {
    const { app } = setup();
    const bad = await app.inject({ method: "POST", url: "/v1/connections/not-a-uuid/start", headers: auth, payload: {} });
    expect(bad.statusCode).toBe(422);
    const badChat = await app.inject({
      method: "POST",
      url: `/v1/connections/${CONN}/messages`,
      headers: auth,
      payload: { organization_id: ORG, chat_id: "../../x", text: "hi", client_message_id: "client-0001" },
    });
    expect(badChat.statusCode).toBe(422);
  });

  it("starts a simulator and reports unknown sessions as 404", async () => {
    const { app, manager } = setup();
    const res = await app.inject({
      method: "POST",
      url: `/v1/connections/${CONN}/start`,
      headers: auth,
      payload: { organization_id: ORG, channel_type: "simulator" },
    });
    expect(res.statusCode).toBe(202);
    expect(manager.list()).toEqual([expect.objectContaining({ connection_id: CONN, organization_id: ORG })]);
    const missing = await app.inject({
      method: "POST",
      url: "/v1/connections/44444444-4444-4444-8444-444444444444/messages",
      headers: auth,
      payload: { organization_id: ORG, chat_id: "1@c.us", text: "hi", client_message_id: "client-0001" },
    });
    expect(missing.statusCode).toBe(404);
    await manager.shutdown();
  });

  it("does not expose simulator routes when disabled", async () => {
    const { app } = setup(false);
    expect((await app.inject({ method: "POST", url: `/v1/simulator/${CONN}/scan`, headers: auth })).statusCode).toBe(404);
  });
});
