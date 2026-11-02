import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import type { ChannelEvent } from "./types.js";

export interface EventPublisher {
  publish(event: ChannelEvent): Promise<void>;
}

type Body<E> = E extends ChannelEvent ? Pick<E, "event_type" | "payload"> : never;

/** Fills in the envelope (fresh event_id for idempotency, timestamp). */
export function buildEvent(organizationId: string, connectionId: string, body: Body<ChannelEvent>): ChannelEvent {
  return {
    event_id: randomUUID(),
    organization_id: organizationId,
    connection_id: connectionId,
    occurred_at: new Date().toISOString(),
    ...body,
  } as ChannelEvent;
}

/** Redis Streams: durable, ordered, consumer groups with ack on the backend side. */
export class RedisStreamPublisher implements EventPublisher {
  constructor(
    private readonly redis: Redis,
    private readonly stream: string,
    private readonly maxLen = 100_000,
  ) {}

  async publish(event: ChannelEvent): Promise<void> {
    await this.redis.xadd(this.stream, "MAXLEN", "~", this.maxLen, "*", "event", JSON.stringify(event));
  }
}

export class MemoryPublisher implements EventPublisher {
  readonly events: ChannelEvent[] = [];
  async publish(event: ChannelEvent): Promise<void> {
    this.events.push(event);
  }
}
