param(
  [Parameter(Mandatory = $true)][string]$BackupFile
)

$ErrorActionPreference = "Stop"
Write-Warning "Este procedimiento histórico restaura SOLO PostgreSQL y modifica el destino. Para recuperación integral aislada use infra/backup/bundle.mjs."
if (-not $env:DATABASE_URL) { throw "DATABASE_URL no está definida." }
$resolved = (Resolve-Path -LiteralPath $BackupFile).Path
Write-Output "Restaurando $resolved"
pg_restore --clean --if-exists --no-owner --no-acl --dbname=$env:DATABASE_URL $resolved
if ($LASTEXITCODE -ne 0) { throw "pg_restore falló." }
Write-Output "Restauración completada. Ejecute las pruebas de salud antes de habilitar usuarios."
