from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.logging import get_logger
from app.core.rate_limit import get_redis
from app.database.session import engine

router = APIRouter(tags=["health"])
log = get_logger(__name__)


@router.get("/health")
async def liveness() -> dict[str, str]:
    """The process is up. Used by container restart policies."""
    return {"status": "ok"}


@router.get("/health/ready")
async def readiness() -> JSONResponse:
    """Dependencies are reachable. Used by load balancers before sending traffic."""
    checks: dict[str, str] = {}
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        log.warning("readiness_database_failed", error=str(exc))
        checks["database"] = "unavailable"
    try:
        await get_redis().ping()
        checks["redis"] = "ok"
    except Exception as exc:
        log.warning("readiness_redis_failed", error=str(exc))
        checks["redis"] = "unavailable"
    healthy = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "checks": checks},
    )
