$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pidPath = Join-Path $projectRoot '.local/processes.json'
if (-not (Test-Path -LiteralPath $pidPath)) {
  Write-Host 'No managed background processes found. If running npm run dev, press Ctrl+C in that terminal.'
  exit
}
$entries = Get-Content -LiteralPath $pidPath -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)" -ErrorAction SilentlyContinue
  if ($process -and $process.CommandLine -like "*$projectRoot*" -and $process.Name -eq 'node.exe') {
    Stop-Process -Id $entry.pid
    Write-Host "Stopped $($entry.name)."
  }
}
Remove-Item -LiteralPath $pidPath
