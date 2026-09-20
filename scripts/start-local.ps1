$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'backend/.env'))) {
    throw 'Configure backend/.env using backend/.env.example before starting.'
}
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules'))) {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
& npm.cmd run db:generate
if ($LASTEXITCODE -ne 0) { throw 'Prisma client generation failed.' }
& npm.cmd run db:migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
Write-Host 'Starting Asset Management at http://localhost:5173 (Ctrl+C stops both services).'
& npm.cmd run dev
