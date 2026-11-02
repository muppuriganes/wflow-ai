import { timingSafeEqual } from "node:crypto";
import Fastify from "fastify";
import { z } from "zod";
import { AdapterError } from "../adapters/types.js";
import type { Logger } from "../logger.js";
import { SessionError, type SessionManager } from "../sessions/manager.js";

const uuid = z.uuid();
const idParams = z.object({ id: uuid });
const startBody = z.object({
  organization_id: uuid,
  channel_type: z.enum(["whatsapp_web", "simulator"]),
  fresh: z.boolean().default(false),
});
const orgBody = z.object({ organization_id: uuid });
const sendBody = z.object({
  organization_id: uuid,
  chat_id: z.string().regex(/^[\w.-]+@(c|g)\.us$/, "Invalid chat id"),
  text: z.string().min(1).max(4096),
  client_message_id: z.string().min(8).max(64),
});
const inboundBody = z.object({
  phone: z.string().regex(/^\+?\d{6,15}$/),
  name: z.string().min(1).max(100),
  text: z.string().min(1).max(4096),
  with_image: z.boolean().default(false),
});
const mediaBody = z.object({
  organization_id: uuid,
  chat_id: z.string().regex(/^[\w.-]+@(c|g)\.us$/, "Invalid chat id"),
  media_url: z.url(),
  file_name: z.string().min(1).max(255),
  content_type: z.string().min(3).max(100),
  caption: z.string().max(1024).nullish(),
  client_message_id: z.string().min(8).max(64),
});

function tokenMatches(header: string | undefined, expected: string): boolean {
  const provided = Buffer.from((header ?? "").replace(/^Bearer\s+/i, ""));
  const wanted = Buffer.from(expected);
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/** Internal API: only the backend calls it, authenticated with the shared INTERNAL_API_TOKEN. */
export function buildServer(manager: SessionManager, opts: { token: string; simulatorEnabled: boolean; logger: Logger }) {
  const app = Fastify({ loggerInstance: opts.logger, bodyLimit: 64 * 1024 });

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    if (!tokenMatches(req.headers.authorization, opts.token)) {
      await reply.code(401).send({ error: { code: "unauthenticated", message: "Invalid internal token" } });
    }
  });

  app.setErrorHandler(async (err, _req, reply) => {
    if (err instanceof z.ZodError) {
      return reply.code(422).send({ error: { code: "validation_error", message: err.issues.map((i) => i.message).join("; ") } });
    }
    if (err instanceof SessionError) return reply.code(err.httpStatus).send({ error: { code: err.code, message: err.message } });
    if (err instanceof AdapterError) return reply.code(409).send({ error: { code: err.code, message: err.message } });
    opts.logger.error({ err: String(err) }, "unhandled_error");
    return reply.code(500).send({ error: { code: "internal_error", message: "Internal error" } });
  });

  app.get("/health", async () => ({ status: "ok", sessions: manager.size }));

  app.get("/v1/connections", async () => manager.list());

  app.post("/v1/connections/:id/start", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const body = startBody.parse(req.body);
    await manager.start(id, body.organization_id, body.channel_type, body.fresh);
    return reply.code(202).send({ status: "starting" });
  });

  app.post("/v1/connections/:id/stop", async (req) => {
    await manager.stop(idParams.parse(req.params).id);
    return { status: "stopped" };
  });

  app.post("/v1/connections/:id/logout", async (req) => {
    await manager.logout(idParams.parse(req.params).id);
    return { status: "logged_out" };
  });

  app.post("/v1/connections/:id/remove", async (req) => {
    const { id } = idParams.parse(req.params);
    await manager.remove(id, orgBody.parse(req.body).organization_id);
    return { status: "removed" };
  });

  app.post("/v1/connections/:id/messages", async (req) => {
    const { id } = idParams.parse(req.params);
    const body = sendBody.parse(req.body);
    const providerMessageId = await manager.sendText(id, body.organization_id, body.chat_id, body.text, body.client_message_id);
    return { provider_message_id: providerMessageId };
  });

  app.post("/v1/connections/:id/media", async (req) => {
    const { id } = idParams.parse(req.params);
    const body = mediaBody.parse(req.body);
    const providerMessageId = await manager.sendMedia(
      id,
      body.organization_id,
      body.chat_id,
      { url: body.media_url, contentType: body.content_type, fileName: body.file_name, caption: body.caption ?? undefined },
      body.client_message_id,
    );
    return { provider_message_id: providerMessageId };
  });

  if (opts.simulatorEnabled) {
    app.post("/v1/simulator/:id/scan", async (req, reply) => {
      manager.simulator(idParams.parse(req.params).id).scan();
      return reply.code(202).send({ status: "scanned" });
    });
    app.post("/v1/simulator/:id/inbound", async (req, reply) => {
      const body = inboundBody.parse(req.body);
      manager.simulator(idParams.parse(req.params).id).inbound(body.phone, body.name, body.text, body.with_image);
      return reply.code(202).send({ status: "delivered" });
    });
  }

  return app;
}
