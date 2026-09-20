param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localDirectory = Join-Path $projectRoot '.local'
New-Item -ItemType Directory -Path $localDirectory -Force | Out-Null
$pidPath = Join-Path $localDirectory 'processes.json'
$existing = @()
if (Test-Path -LiteralPath $pidPath) { $existing = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json }
$nodePath = (Get-Command node.exe).Source
$definitions = @(
  @{ name = 'backend'; script = (Join-Path $projectRoot 'backend/dist/server.js'); directory = (Join-Path $projectRoot 'backend'); port = 5000; extra = ''; url = 'http://127.0.0.1:5000/api/health' },
  @{ name = 'frontend'; script = (Join-Path $projectRoot 'node_modules/vite/bin/vite.js'); directory = (Join-Path $projectRoot 'frontend'); port = 5173; extra = ' --host 127.0.0.1'; url = 'http://127.0.0.1:5173' }
)
$processes = @()
foreach ($definition in $definitions) {
  $definition.script = [System.IO.Path]::GetFullPath($definition.script)
  $definition.directory = [System.IO.Path]::GetFullPath($definition.directory)
  $previous = $existing | Where-Object { $_.name -eq $definition.name } | Select-Object -First 1
  $running = $null
  if ($previous) {
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId = $($previous.pid)" -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.Name -eq 'node.exe' -and $candidate.CommandLine -and $candidate.CommandLine.Replace('/', '\').Contains($definition.script)) { $running = $candidate }
  }
  if ($running -and $Restart) { Stop-Process -Id $running.ProcessId; Wait-Process -Id $running.ProcessId -Timeout 5 -ErrorAction SilentlyContinue; $running = $null }
  if ($running) { $processes += @{ name = $definition.name; pid = $running.ProcessId }; continue }
  $occupied = Get-NetTCPConnection -State Listen -LocalPort $definition.port -ErrorAction SilentlyContinue
  if ($occupied) { throw "Port $($definition.port) is occupied by another process. Stop it before starting $($definition.name)." }
  if (-not (Test-Path -LiteralPath $definition.script)) { throw "Missing $($definition.script). Run npm ci and npm run build first." }
  $started = Start-Process -FilePath $nodePath -ArgumentList ('"' + $definition.script + '"' + $definition.extra) -WorkingDirectory $definition.directory -RedirectStandardOutput (Join-Path $localDirectory "$($definition.name).stdout.log") -RedirectStandardError (Join-Path $localDirectory "$($definition.name).stderr.log") -WindowStyle Hidden -PassThru
  $processes += @{ name = $definition.name; pid = $started.Id }
  $processes | ConvertTo-Json | Set-Content -LiteralPath $pidPath
}
$processes | ConvertTo-Json | Set-Content -LiteralPath $pidPath
foreach ($definition in $definitions) {
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try { $response = Invoke-WebRequest -Uri $definition.url -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { $ready = $true; break } } catch { }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw "$($definition.name) did not become ready. See $localDirectory logs." }
}
Write-Host 'Asset Management is running at http://localhost:5173'
Write-Host 'API: http://127.0.0.1:5000/api/health'
Write-Host 'Stop with: powershell -ExecutionPolicy Bypass -File scripts/stop-local.ps1'
