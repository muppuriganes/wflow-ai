"""Server-Sent Events: pushes "something changed" notifications to the browser.

The browser connects with fetch() + Authorization header (EventSource cannot send headers).
Each stream lives at most as long as an access token, then the client reconnects with a fresh
token, so a revoked or demoted user stops receiving notifications within minutes.
"""

import asyncio
import time
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from redis.asyncio import Redis

from app.api.deps import DB, OrgCtx
from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.realtime import org_channel

router = APIRouter(prefix="/organizations/{org_id}", tags=["realtime"])
log = get_logger(__name__)

HEARTBEAT_SECONDS = 20


@router.get("/events/stream")
async def event_stream(db: DB, ctx: OrgCtx) -> StreamingResponse:
    ctx.require("inbox.read")
    org_id = ctx.org_id
    # Release the database connection: the stream can stay open for minutes.
    await db.close()
    settings = get_settings()
    max_seconds = settings.access_token_ttl_minutes * 60

    async def events() -> AsyncIterator[str]:
        redis = Redis.from_url(settings.redis_url, decode_responses=True)
        pubsub = redis.pubsub()
        await pubsub.subscribe(org_channel(org_id))
        started = last_beat = time.monotonic()
        yield "retry: 3000\n: connected\n\n"
        try:
            while time.monotonic() - started < max_seconds:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=5.0)
                if message and message.get("type") == "message":
                    yield f"event: change\ndata: {message['data']}\n\n"
                if time.monotonic() - last_beat > HEARTBEAT_SECONDS:
                    last_beat = time.monotonic()
                    yield ": ping\n\n"
        except asyncio.CancelledError:
            pass  # client went away
        finally:
            await pubsub.unsubscribe()
            await pubsub.aclose()
            await redis.aclose()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
