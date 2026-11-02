# WFlow AI

**Connect. Understand. Automate. Grow.**

Multi-tenant business automation SaaS: WhatsApp connectivity, unified inbox, CRM, visual workflows —
with AI agents planned as a later track.

> **Status:** Milestones M0 (setup) and M1 (foundation) are complete. See
> [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) for exactly what works today.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript (strict), Tailwind CSS v4, Radix UI, TanStack Query, React Router |
| Backend | Python 3.12, FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2 |
| Data | PostgreSQL 17 + pgvector, Row Level Security for tenant isolation |
| Infra | Redis (rate limiting, later queues), MinIO (files), Mailpit (dev email), Docker Compose |
| Later | Node.js messaging gateway (whatsapp-web.js) in M2, Temporal in M4 |

## Quick start (development)

Prerequisites: Docker Desktop, Python 3.12 + [uv](https://docs.astral.sh/uv/), Node.js 20.19+.

```bash
cp .env.example .env          # then replace every change-me value
docker compose up -d          # postgres, redis, minio, mailpit
```

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run python -m app.cli sync-rbac
uv run uvicorn app.main:app --port 8100 --reload
```

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5180
```

| Service | URL |
|---|---|
| Web app | http://localhost:5180 |
| API docs (OpenAPI) | http://localhost:8100/api/docs |
| Health / readiness | http://localhost:8100/api/v1/health, `/health/ready` |
| Mailpit (all dev email) | http://localhost:58025 |
| MinIO console | http://localhost:59001 |

Ports are intentionally non-default so WFlow runs beside other local stacks.

### Everything in containers

```bash
docker compose --profile app up -d --build
```

## Tests

```bash
cd backend && uv run pytest        # needs `docker compose up -d` (uses the wflow_test database)
cd frontend && npm test
```

## Documentation

| Document | Purpose |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design and key decisions |
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Milestone roadmap |
| [DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md) | What is built, tested and pending |
| [DATABASE_DESIGN.md](docs/DATABASE_DESIGN.md) | Schema, ER diagram, RLS policies |
| [API_SPECIFICATION.md](docs/API_SPECIFICATION.md) | Endpoints and conventions |
| [SECURITY.md](docs/SECURITY.md) | Security model |
| [TESTING.md](docs/TESTING.md) | Test strategy and how to run |
| [WHATSAPP_CONNECTOR.md](docs/WHATSAPP_CONNECTOR.md) | Channel strategy and risks |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common problems |
