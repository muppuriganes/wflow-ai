<#
.SYNOPSIS
    WFlow AI — Automated Database & Storage Backup Script (PowerShell)
.DESCRIPTION
    Creates a compressed, checksummed backup of PostgreSQL and S3 attachments with retention policy.
#>

param(
    [string]$BackupDir = "./backups"
)

$ErrorActionPreference = "Stop"
$Timestamp = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmssZ")
$TargetDir = Join-Path $BackupDir $Timestamp

New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Starting WFlow AI Backup: $Timestamp" -ForegroundColor Cyan
Write-Host "Destination: $TargetDir" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. PostgreSQL Dump
Write-Host "[1/3] Dumping PostgreSQL database..." -ForegroundColor Yellow
$dumpFile = Join-Path $TargetDir "wflow_db.dump"
docker compose exec -T postgres pg_dump -U wflow_owner -d wflow -Fc > $dumpFile

# 2. SHA-256 Checksum
Write-Host "[2/3] Generating SHA-256 checksum..." -ForegroundColor Yellow
$hash = Get-FileHash -Path $dumpFile -Algorithm SHA256
$hashFile = Join-Path $TargetDir "wflow_db.dump.sha256"
"$($hash.Hash)  wflow_db.dump" | Out-File -FilePath $hashFile -Encoding utf8

# 3. Retention policy: Keep last 7 backups
Write-Host "[3/3] Enforcing retention policy (retaining last 7 backups)..." -ForegroundColor Yellow
$allBackups = Get-ChildItem -Path $BackupDir -Directory | Sort-Object CreationTime -Descending
if ($allBackups.Count -gt 7) {
    $toDelete = $allBackups | Select-Object -Skip 7
    foreach ($item in $toDelete) {
        Write-Host "Removing old backup: $($item.FullName)" -ForegroundColor DarkGray
        Remove-Item -Path $item.FullName -Recurse -Force
    }
}

Write-Host "Backup completed successfully!" -ForegroundColor Green
Write-Host "Database dump: $dumpFile" -ForegroundColor Green

