import re
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import register_error_handlers
from app.core.logging import configure_logging, get_logger
from app.core.metrics import (
    DB_POOL_ACTIVE_CONNECTIONS,
    DB_POOL_SIZE,
    HTTP_REQUEST_DURATION_SECONDS,
    HTTP_REQUESTS_TOTAL,
    render_metrics,
)
from app.core.rate_limit import close_redis
from app.core.request_context import RequestMeta, set_request_meta
from app.database.session import engine

log = get_logger("app")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    yield
    await close_redis()
    await engine.dispose()


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json=settings.environment == "production")

    app = FastAPI(
        title="WFlow AI API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    register_error_handlers(app)

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-request-id", "")
        request_id = incoming if 8 <= len(incoming) <= 64 and incoming.isascii() else uuid.uuid4().hex
        request.state.request_id = request_id
        set_request_meta(
            RequestMeta(
                request_id=request_id,
                ip_address=request.client.host if request.client else None,
                user_agent=request.headers.get("user-agent"),
            )
        )
        structlog.contextvars.bind_contextvars(request_id=request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.unbind_contextvars("request_id")
        duration = time.perf_counter() - started
        response.headers["X-Request-ID"] = request_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; "
                "connect-src 'self' ws: wss:; "
                "frame-ancestors 'none';"
            )

        # Telemetry: Record metrics without high-cardinality raw IDs
        if request.url.path != "/metrics":
            norm_path = re.sub(r"[0-9a-fA-F-]{36}", ":id", request.url.path)
            HTTP_REQUESTS_TOTAL.labels(
                method=request.method, path=norm_path, status=str(response.status_code)
            ).inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(method=request.method, path=norm_path).observe(duration)

        log.info(
            "request",
            method=request.method,
            path=request.url.path,
            status=response.status_code,
            duration_ms=round(duration * 1000, 1),
        )
        return response

    @app.get("/metrics", include_in_schema=False)
    async def metrics_endpoint() -> Response:
        try:
            DB_POOL_ACTIVE_CONNECTIONS.set(engine.sync_engine.pool.checkedout())
            DB_POOL_SIZE.set(engine.sync_engine.pool.size())
        except Exception as exc:
            log.debug("metrics_pool_sampling_skipped", error=str(exc))
        body, content_type = render_metrics()
        return Response(content=body, media_type=content_type)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID"],
    )
    app.include_router(api_router)
    return app


app = create_app()
