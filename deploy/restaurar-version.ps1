param(
  [Parameter(Mandatory = $true)] [string]$ReleaseArchive,
  [Parameter(Mandatory = $true)] [string]$TargetDirectory
)

if (-not (Test-Path -LiteralPath $ReleaseArchive)) { throw "No se encontró el archivo de versión indicado." }
if (-not (Test-Path -LiteralPath $TargetDirectory)) { throw "No se encontró el directorio de destino indicado." }

Write-Host "Verificá el respaldo de base de datos antes de restaurar esta versión."
Write-Host "Restauración pendiente de ejecutar manualmente en el hosting: $ReleaseArchive"
