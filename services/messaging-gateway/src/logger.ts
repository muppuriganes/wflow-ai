import pino from "pino";

/** Message bodies, QR payloads and tokens are never logged. */
export function createLogger(level: string) {
  return pino({
    level,
    base: { service: "messaging-gateway" },
    redact: {
      paths: ["*.token", "*.authorization", "req.headers.authorization", "*.qr", "*.text", "*.content", "*.body"],
      censor: "***",
    },
  });
}

export type Logger = ReturnType<typeof createLogger>;
