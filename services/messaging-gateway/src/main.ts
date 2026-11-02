import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { RedisStreamPublisher } from "./events/publisher.js";
import { buildServer } from "./http/server.js";
import { createLogger, type Logger } from "./logger.js";
import { type ChannelType, SessionManager } from "./sessions/manager.js";
import { BackendMediaUploader } from "./sessions/media.js";
import { RedisQrStore } from "./sessions/qr-store.js";

type RestoreItem = { connection_id: string; organization_id: string; channel_type: ChannelType };

/** Resume sessions that were connected before this process started (credentials are on disk). */
async function restoreSessions(manager: SessionManager, backendUrl: string, token: string, log: Logger): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const res = await fetch(`${backendUrl}/api/v1/internal/channels/restore`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`backend responded ${res.status}`);
      const items = (await res.json()) as RestoreItem[];
      log.info({ count: items.length }, "restoring_sessions");
      for (const item of items) {
        try {
          await manager.start(item.connection_id, item.organization_id, item.channel_type);
        } catch (err) {
          log.error({ err: String(err), connectionId: item.connection_id }, "restore_failed");
        }
        await new Promise((r) => setTimeout(r, 2000)); // stagger browser launches
      }
      return;
    } catch (err) {
      log.warn({ err: String(err), attempt }, "restore_backend_unavailable");
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
  log.error("restore_gave_up");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  const manager = new SessionManager(
    new RedisStreamPublisher(redis, config.CHANNEL_EVENT_STREAM),
    new RedisQrStore(redis, config.QR_TTL_SECONDS),
    {
      sessionRoot: config.SESSION_ROOT,
      maxSessions: config.GATEWAY_MAX_SESSIONS,
      sendLimitPerMinute: config.GATEWAY_SEND_LIMIT_PER_MINUTE,
      qrMaxRetries: config.QR_MAX_RETRIES,
      puppeteerArgs: config.PUPPETEER_ARGS.split(",").map((a) => a.trim()).filter(Boolean),
      chromeExecutablePath: config.CHROME_EXECUTABLE_PATH,
      simulatorEnabled: config.SIMULATOR_ENABLED,
      mediaUploader: new BackendMediaUploader(config.BACKEND_INTERNAL_URL, config.INTERNAL_API_TOKEN),
    },
    log,
  );
  const server = buildServer(manager, { token: config.INTERNAL_API_TOKEN, simulatorEnabled: config.SIMULATOR_ENABLED, logger: log });
  await server.listen({ host: config.GATEWAY_HOST, port: config.GATEWAY_PORT });
  void restoreSessions(manager, config.BACKEND_INTERNAL_URL, config.INTERNAL_API_TOKEN, log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting_down");
    await server.close();
    await manager.shutdown();
    redis.disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
