"""Real-time change notifications for the browser (Server-Sent Events over Redis pub/sub).

Payloads carry only what changed and its id, never message content: clients refetch through
the normal API, so permissions and Row Level Security apply to everything they see.
"""

import json
import uuid
from typing import Any

from redis.exceptions import RedisError

from app.core.logging import get_logger
from app.core.rate_limit import get_redis

log = get_logger(__name__)


def org_channel(organization_id: uuid.UUID | str) -> str:
    return f"wflow:org:{organization_id}:events"


async def publish(organization_id: uuid.UUID | str, event_type: str, **ids: Any) -> None:
    """Best effort: a missed notification only delays a UI refresh (clients also poll slowly)."""
    payload = json.dumps(
        {"type": event_type, **{k: str(v) if v is not None else None for k, v in ids.items()}}
    )
    try:
        await get_redis().publish(org_channel(organization_id), payload)
    except RedisError:
        log.warning("realtime_publish_failed", event_type=event_type)
