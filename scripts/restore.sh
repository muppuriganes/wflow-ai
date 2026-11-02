#!/usr/bin/env bash
# WFlow AI — Disaster Recovery & Database Restore Script
# Usage: ./scripts/restore.sh /path/to/wflow_db.dump

set -euo pipefail

if [ -z "${1:-}" ]; then
    echo "Error: Path to wflow_db.dump is required."
    echo "Usage: ./scripts/restore.sh /path/to/wflow_db.dump"
    exit 1
fi

DUMP_PATH="$1"

if [ ! -f "${DUMP_PATH}" ]; then
    echo "Error: File not found: ${DUMP_PATH}"
    exit 1
fi

echo "=========================================="
echo "WFlow AI — Disaster Recovery Restore"
echo "Source Dump: ${DUMP_PATH}"
echo "=========================================="

# Check for checksum if available
if [ -f "${DUMP_PATH}.sha256" ]; then
    echo "[1/4] Verifying SHA-256 checksum..."
    (cd "$(dirname "${DUMP_PATH}")" && sha256sum -c "$(basename "${DUMP_PATH}").sha256")
fi

echo "[2/4] Terminating active connections to database..."
docker compose exec -T postgres psql -U "${POSTGRES_USER:-wflow_owner}" -d postgres -c "
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${POSTGRES_DB:-wflow}' AND pid <> pg_backend_pid();
"

echo "[3/4] Restoring database schema and data..."
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-wflow_owner}" -d "${POSTGRES_DB:-wflow}" --clean --if-exists < "${DUMP_PATH}" || true

echo "[4/4] Synchronizing system roles and RBAC..."
docker compose exec -T backend python -m app.cli sync-rbac || true

echo "=========================================="
echo "Restore complete! Run health checks to verify."
echo "=========================================="

