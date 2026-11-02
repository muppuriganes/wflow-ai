import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Share the repo-root .env in development; real deployments inject environment variables.
const rootEnv = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.env");
if (existsSync(rootEnv) && !process.env.GATEWAY_SKIP_DOTENV) process.loadEnvFile(rootEnv);

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const schema = z.object({
  ENVIRONMENT: z.enum(["development", "test", "production"]).default("development"),
  GATEWAY_HOST: z.string().default("127.0.0.1"),
  GATEWAY_PORT: z.coerce.number().int().positive().default(8200),
  INTERNAL_API_TOKEN: z.string().min(1, "INTERNAL_API_TOKEN is required"),
  REDIS_URL: z.string().default("redis://127.0.0.1:56379/0"),
  CHANNEL_EVENT_STREAM: z.string().default("wflow:channel-events"),
  BACKEND_INTERNAL_URL: z.string().default("http://127.0.0.1:8100"),
  // Root directory for per-tenant WhatsApp session data: <root>/<organization_id>/<connection_id>
  SESSION_ROOT: z.string().default(".sessions"),
  GATEWAY_MAX_SESSIONS: z.coerce.number().int().positive().default(10),
  GATEWAY_SEND_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(30),
  QR_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  // Number of QR refreshes before giving up (each lasts ~20s on WhatsApp Web).
  QR_MAX_RETRIES: z.coerce.number().int().positive().default(6),
  SIMULATOR_ENABLED: bool.default(true),
  // Extra Chromium flags, comma separated. Containers typically need "--no-sandbox".
  PUPPETEER_ARGS: z.string().default(""),
  // Use a system Chromium (containers) instead of the browser puppeteer downloads.
  CHROME_EXECUTABLE_PATH: z.string().optional(),
  LOG_LEVEL: z.string().default("info"),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid gateway configuration: ${issues}`);
  }
  const config = parsed.data;
  if (config.ENVIRONMENT === "production") {
    if (config.INTERNAL_API_TOKEN.length < 32) throw new Error("INTERNAL_API_TOKEN must be 32+ characters in production");
    if (config.SIMULATOR_ENABLED) throw new Error("SIMULATOR_ENABLED must be false in production");
  }
  return config;
}
