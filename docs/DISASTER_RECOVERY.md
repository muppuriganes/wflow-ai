# Disaster Recovery & Backup Runbook

_Milestone 7 — Hardening & Operational Runbook_

This runbook documents the disaster recovery procedures, automated backup policies, and restoration steps for **WFlow AI** production environments.

---

## 1. Backup Strategy & Retention Policy

### Backup Artifacts
1. **PostgreSQL Database:** Compressed custom-format archive (`wflow_db.dump`) generated via `pg_dump -Fc`. Contains all tenant schemas, tables, RLS policies, indexes, and audit logs.
2. **SHA-256 Checksums:** Cryptographic digest file (`wflow_db.dump.sha256`) generated immediately after export to detect bit rot or transmission corruption.
3. **Object Storage (MinIO / S3):** All customer media, documents, and WhatsApp audio/video files stored under tenant prefixes (`{organization_id}/...`).

### Schedule & Retention
- **Frequency:** Nightly automated cron execution at `02:00 UTC`.
- **Retention:** Rolling **7-day retention** policy. Backups older than 7 days are automatically purged.
- **Off-Site Replication:** In production, dump archives should be synchronized to an off-site, immutable cloud storage bucket (e.g. AWS S3 Glacier with Object Lock).

---

## 2. Taking a Manual Backup

Run the automated backup script from the repository root:

### Linux / macOS
```bash
./scripts/backup.sh ./backups
```

### Windows (PowerShell)
```powershell
.\scripts\backup.ps1 -BackupDir .\backups
```

This creates a timestamped folder: `backups/YYYYMMDD_HHMMSSZ/` containing:
- `wflow_db.dump`
- `wflow_db.dump.sha256`

---

## 3. Disaster Recovery Restoration Procedure

### Prerequisites
1. Docker Compose infrastructure stack running (`docker compose up -d`).
2. Valid backup dump file with matching `.sha256` checksum.

### Step-by-Step Restoration

#### Step 1: Run the Restore Script
```powershell
# Windows
.\scripts\restore.ps1 -DumpPath .\backups\20261102_183000Z\wflow_db.dump

# Linux
./scripts/restore.sh ./backups/20261102_183000Z/wflow_db.dump
```

The restore script automatically:
1. Verifies the SHA-256 cryptographic checksum.
2. Terminates active client connections to the database to prevent locking deadlocks.
3. Executes `pg_restore --clean --if-exists` as `wflow_owner`.
4. Runs `sync-rbac` to refresh system roles and permissions.

#### Step 2: Verify Database & Row Level Security (RLS)
Execute the verification query to confirm RLS policies are active:
```sql
SELECT relname, relrowsecurity, relforcerowsecurity 
FROM pg_class 
WHERE relname IN ('organizations', 'contacts', 'conversations', 'messages', 'workflows');
```
*Expected: `relrowsecurity` must be `true` for all tenant tables.*

#### Step 3: Run Diagnostic Health Probes
Verify system components via the Super Admin health probe:
```bash
curl -f http://localhost:8100/api/v1/health/ready
```
*Expected response: `{"status": "ready", "database": "ok", "redis": "ok"}`*

---

## 4. Disaster Recovery Scenarios

| Scenario | Recovery Action | Target RTO / RPO |
|---|---|:---:|
| **Accidental Org Deletion** | Restore dump to a staging database and extract the specific organization's rows. | RTO: 30 min<br>RPO: ≤ 24 hrs |
| **Complete Host / Cluster Failure** | Deploy clean stack via `docker-compose.prod.yml`, run `restore.sh`, and update DNS. | RTO: 45 min<br>RPO: ≤ 24 hrs |
| **Storage (S3) Corruption** | Restore bucket snapshot from AWS S3 versioned bucket replication. | RTO: 15 min<br>RPO: ≤ 1 hr |

