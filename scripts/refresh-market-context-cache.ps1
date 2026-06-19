param(
    [string]$BackendPath = ".\backend",
    [int]$Limit = 30
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backend = Resolve-Path (Join-Path $root $BackendPath)

Push-Location $backend
try {
    $env:PYTHONPATH = (Get-Location).Path
    python -c "import json; from app.data.market_context_fetcher import refresh_market_context_cache; print(json.dumps(refresh_market_context_cache(limit=$Limit), ensure_ascii=False, indent=2))"
}
finally {
    Pop-Location
}
