param([Parameter(Mandatory=$true)][string]$DatabasePath)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$dbFullPath = [System.IO.Path]::GetFullPath($DatabasePath)
$repoFullPath = [System.IO.Path]::GetFullPath($repo)
$repoPrefix = $repoFullPath.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
if ($dbFullPath.Equals($repoFullPath, [System.StringComparison]::OrdinalIgnoreCase) -or $dbFullPath.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Choose a temporary SQLite path outside the project directory.' }
if (Test-Path -LiteralPath $dbFullPath) { throw ('Refusing to overwrite existing database: ' + $dbFullPath) }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dbFullPath) | Out-Null
[System.IO.File]::WriteAllBytes($dbFullPath, [byte[]]@())
$oldDatabaseUrl = $env:DATABASE_URL
try {
  $env:DATABASE_URL = 'file:' + ($dbFullPath -replace '\\', '/')
  Push-Location $repo
  try {
    npx prisma db push --skip-generate
    if ($LASTEXITCODE -ne 0) { throw ('prisma db push failed: ' + $LASTEXITCODE) }
    node scripts/s2-isolated-flow-acceptance.mjs $repo $dbFullPath
    if ($LASTEXITCODE -ne 0) { throw ('fixture acceptance failed: ' + $LASTEXITCODE) }
  } finally { Pop-Location }
} finally { $env:DATABASE_URL = $oldDatabaseUrl }
