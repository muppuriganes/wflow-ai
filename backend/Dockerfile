FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.11.5 /uv /usr/local/bin/uv
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY . .
RUN useradd --create-home --uid 10001 wflow && chown -R wflow /app
USER wflow
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000

# Migrations + RBAC sync run on start; both are idempotent.
CMD ["sh", "-c", "alembic upgrade head && python -m app.cli sync-rbac && uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers"]
