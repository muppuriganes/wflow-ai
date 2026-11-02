import type { Redis } from "ioredis";
import QRCode from "qrcode";

export interface QrStore {
  put(connectionId: string, qr: string): Promise<void>;
  clear(connectionId: string): Promise<void>;
}

/** Key format shared with backend/app/services/channels.py (qr_key). */
export const qrKey = (connectionId: string) => `wflow:gw:qr:${connectionId}`;

/**
 * QR codes grant device linking, so they are kept only briefly in Redis (never on the event
 * stream, never logged) and rendered to a PNG data URL here so browsers never see raw QR data.
 */
export class RedisQrStore implements QrStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
  ) {}

  async put(connectionId: string, qr: string): Promise<void> {
    const dataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 288, errorCorrectionLevel: "M" });
    await this.redis.set(qrKey(connectionId), dataUrl, "EX", this.ttlSeconds);
  }

  async clear(connectionId: string): Promise<void> {
    await this.redis.del(qrKey(connectionId));
  }
}

export class MemoryQrStore implements QrStore {
  readonly codes = new Map<string, string>();
  async put(connectionId: string, qr: string): Promise<void> {
    this.codes.set(connectionId, qr);
  }
  async clear(connectionId: string): Promise<void> {
    this.codes.delete(connectionId);
  }
}
