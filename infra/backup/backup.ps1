param(
  [string]$OutputDirectory = "../../backups"
)

$ErrorActionPreference = "Stop"
$resolved = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot $OutputDirectory))
New-Item -ItemType Directory -Path $resolved -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$file = Join-Path $resolved "jr-platform-$stamp.dump"

if (-not $env:DATABASE_URL) { throw "DATABASE_URL no está definida." }
pg_dump --format=custom --no-owner --no-acl --file=$file $env:DATABASE_URL
if ($LASTEXITCODE -ne 0) { throw "pg_dump falló." }

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $file).Hash.ToLowerInvariant()
Write-Output "Copia creada: $file"
Write-Output "SHA256: $hash"

$retention = if ($env:BACKUP_RETENTION_DAYS) { [int]$env:BACKUP_RETENTION_DAYS } else { 30 }
Get-ChildItem -LiteralPath $resolved -Filter "jr-platform-*.dump" -File |
  Where-Object LastWriteTime -lt (Get-Date).AddDays(-$retention) |
  Remove-Item -Force
