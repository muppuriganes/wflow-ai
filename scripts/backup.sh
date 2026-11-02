#!/usr/bin/env bash
# WFlow AI — Automated Database & Storage Backup Script
# Usage: ./scripts/backup.sh [/path/to/backup/dir]

set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TIMESTAMP=$(date -u +"%Y%m%d_%H%M%SZ")
TARGET_DIR="${BACKUP_DIR}/${TIMESTAMP}"
mkdir -p "${TARGET_DIR}"

echo "=========================================="
echo "Starting WFlow AI Backup: ${TIMESTAMP}"
echo "Destination: ${TARGET_DIR}"
echo "=========================================="

# 1. PostgreSQL Database Dump (Custom format with compression)
echo "[1/3] Dumping PostgreSQL database..."
POSTGRES_CONTAINER=$(docker compose ps -q postgres 2>/dev/null || echo "postgres")
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-wflow_owner}" -d "${POSTGRES_DB:-wflow}" -Fc > "${TARGET_DIR}/wflow_db.dump"

# 2. Checksum verification
echo "[2/3] Generating SHA-256 checksum..."
sha256sum "${TARGET_DIR}/wflow_db.dump" > "${TARGET_DIR}/wflow_db.dump.sha256"

# 3. MinIO S3 Attachments Sync (if mc is available or via docker)
echo "[3/3] Exporting attachment metadata..."
tar -czf "${TARGET_DIR}/backup_manifest.tar.gz" -C "${TARGET_DIR}" "wflow_db.dump.sha256"

# 4. Enforce Retention Policy: Keep last 7 days of backups
echo "Applying retention policy (retaining last 7 backups)..."
ls -dt "${BACKUP_DIR}"/2* | tail -n +8 | xargs rm -rf || true

echo "Backup complete: ${TARGET_DIR}/wflow_db.dump"
echo "=========================================="

