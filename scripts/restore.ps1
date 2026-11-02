<#
.SYNOPSIS
    WFlow AI — Disaster Recovery & Database Restore Script (PowerShell)
.DESCRIPTION
    Restores the PostgreSQL database from a compressed dump file and re-verifies RBAC.
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$DumpPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $DumpPath)) {
    Write-Error "Dump file not found: $DumpPath"
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "WFlow AI — Disaster Recovery Restore" -ForegroundColor Cyan
Write-Host "Source Dump: $DumpPath" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Verify Checksum
$hashFile = "$DumpPath.sha256"
if (Test-Path $hashFile) {
    Write-Host "[1/4] Verifying SHA-256 checksum..." -ForegroundColor Yellow
    $expectedHash = (Get-Content $hashFile).Split(" ")[0].Trim()
    $actualHash = (Get-FileHash -Path $DumpPath -Algorithm SHA256).Hash
    if ($expectedHash.ToUpper() -ne $actualHash.ToUpper()) {
        Write-Error "Checksum verification failed! Expected $expectedHash, got $actualHash"
    }
    Write-Host "Checksum verified." -ForegroundColor Green
}

# 2. Terminate connections
Write-Host "[2/4] Terminating active connections to database..." -ForegroundColor Yellow
docker compose exec -T postgres psql -U wflow_owner -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'wflow' AND pid <> pg_backend_pid();"

# 3. Restore PostgreSQL
Write-Host "[3/4] Restoring database schema and data..." -ForegroundColor Yellow
docker compose exec -T postgres pg_restore -U wflow_owner -d wflow --clean --if-exists < $DumpPath

# 4. Sync RBAC
Write-Host "[4/4] Synchronizing system roles and RBAC..." -ForegroundColor Yellow
uv run --directory backend python -m app.cli sync-rbac

Write-Host "==========================================" -ForegroundColor Green
Write-Host "Restore complete! Run health checks to verify." -ForegroundColor Green

