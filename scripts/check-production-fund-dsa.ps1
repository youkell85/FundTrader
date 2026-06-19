# FundTrader DSA production smoke.
# Read-only checks for provider health, field provenance, detail enrichments, and report exports.

param(
    [string]$BaseUrl = "http://43.160.226.62/fund/api",
    [string]$Code = "000001",
    [int]$TimeoutSeconds = 30,
    [switch]$VerboseJson
)

$ErrorActionPreference = "Stop"
$script:PassCount = 0
$script:WarnCount = 0
$script:FailCount = 0

function Pass([string]$Msg) {
    Write-Host "  PASS  $Msg" -ForegroundColor Green
    $script:PassCount++
}

function Warn([string]$Msg) {
    Write-Host "  WARN  $Msg" -ForegroundColor Yellow
    $script:WarnCount++
}

function Fail([string]$Msg) {
    Write-Host "  FAIL  $Msg" -ForegroundColor Red
    $script:FailCount++
}

function Step([string]$Label) {
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
}

function Get-Json([string]$Path) {
    $url = "$BaseUrl$Path"
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec $TimeoutSeconds -UseBasicParsing
        $json = $response.Content | ConvertFrom-Json -ErrorAction Stop
        if ($VerboseJson) {
            $summary = $json | ConvertTo-Json -Compress -Depth 5
            if ($summary.Length -gt 500) { $summary = $summary.Substring(0, 500) + "..." }
            Write-Host "  [json] $Path $summary" -ForegroundColor DarkGray
        }
        return @{ Ok = $true; StatusCode = $response.StatusCode; Json = $json; Url = $url }
    }
    catch {
        return @{ Ok = $false; Error = $_.Exception.Message; Url = $url }
    }
}

function Check-Http([string]$Path) {
    $url = "$BaseUrl$Path"
    try {
        $response = Invoke-WebRequest -Uri $url -TimeoutSec $TimeoutSeconds -UseBasicParsing
        return @{ Ok = $true; StatusCode = $response.StatusCode; Url = $url }
    }
    catch {
        return @{ Ok = $false; Error = $_.Exception.Message; Url = $url }
    }
}

Step "1. Health"
$health = Get-Json "/health"
if ($health.Ok -and $health.Json.status -eq "ok") { Pass "health status=ok" } else { Fail "health failed: $($health.Error)" }

Step "2. Provider Health"
$providers = Get-Json "/data-sources/status"
if ($providers.Ok -and $providers.Json.totalCount -gt 0) {
    $available = [int]$providers.Json.availableCount
    $total = [int]$providers.Json.totalCount
    if ($available -gt 0) { Pass "providers available $available/$total" } else { Fail "no providers available" }
}
else {
    Fail "provider health unavailable: $($providers.Error)"
}

Step "3. Detail Field Coverage"
$fields = Get-Json "/fund/detail-fields?code=$Code"
if ($fields.Ok) {
    $coverage = [double]$fields.Json.coverage
    if ($coverage -ge 0.80) { Pass "detail field coverage $coverage" } else { Fail "detail field coverage too low: $coverage" }
    if ($fields.Json.fieldSources) { Pass "fieldSources present" } else { Fail "fieldSources missing" }
}
else {
    Fail "detail-fields unavailable: $($fields.Error)"
}

$complete = Get-Json "/fund/detail-completeness?code=$Code"
if ($complete.Ok) {
    if ([int]$complete.Json.available -ge 12) { Pass "detail sections available $($complete.Json.available)/$($complete.Json.total)" } else { Fail "too few available detail sections" }
}
else {
    Fail "detail-completeness unavailable: $($complete.Error)"
}

Step "4. Enriched Detail Endpoints"
$bond = Get-Json "/fund/bond-holdings?code=$Code"
if ($bond.Ok) {
    $rows = @($bond.Json.rows)
    if ($rows.Count -gt 0) { Pass "bond holdings rows=$($rows.Count)" } else { Warn "bond holdings empty for $Code" }
    $withCode = @($rows | Where-Object { $_.bondCode }).Count
    if ($rows.Count -eq 0 -or $withCode -gt 0) { Pass "bond codes present when rows exist" } else { Fail "bond rows missing bondCode" }
}
else {
    Fail "bond-holdings unavailable: $($bond.Error)"
}

$turnover = Get-Json "/fund/turnover-history?code=$Code&periods=8"
if ($turnover.Ok) {
    $rows = @($turnover.Json.rows)
    if ($rows.Count -ge 4 -and [double]$turnover.Json.coverage -ge 0.5) { Pass "turnover rows=$($rows.Count), coverage=$($turnover.Json.coverage)" } else { Fail "turnover coverage too low" }
}
else {
    Fail "turnover-history unavailable: $($turnover.Error)"
}

$purchase = Get-Json "/fund/purchase-info?code=$Code"
if ($purchase.Ok) {
    if ($purchase.Json.dataStatus -eq "available" -and $purchase.Json.source) { Pass "purchase info available via $($purchase.Json.source)" } else { Warn "purchase info status=$($purchase.Json.dataStatus)" }
}
else {
    Fail "purchase-info unavailable: $($purchase.Error)"
}

$market = Get-Json "/fund/$Code/market-context"
if ($market.Ok) {
    if ($market.Json.sections.northFlow -and $market.Json.sections.sectorFlow) { Pass "market context sections present" } else { Fail "market context missing expected sections" }
    if ($market.Json.coverage -lt 0.5) { Warn "market context coverage low: $($market.Json.coverage)" }
}
else {
    Fail "market-context unavailable: $($market.Error)"
}

Step "5. Research Report Exports"
foreach ($format in @("md", "docx", "pdf")) {
    $result = Check-Http "/fund/$Code/research-report?format=$format"
    if ($result.Ok -and $result.StatusCode -eq 200) { Pass "research-report format=$format HTTP 200" } else { Fail "research-report format=$format failed: $($result.Error)" }
}

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  FUND DSA SMOKE RESULTS" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host "  PASS: $script:PassCount" -ForegroundColor Green
Write-Host "  WARN: $script:WarnCount" -ForegroundColor Yellow
Write-Host "  FAIL: $script:FailCount" -ForegroundColor Red

if ($script:FailCount -gt 0) {
    Write-Host "`nSMOKE CHECK: SOME CHECKS FAILED" -ForegroundColor Red
    exit 1
}

Write-Host "`nSMOKE CHECK: ALL REQUIRED CHECKS PASSED" -ForegroundColor Green
exit 0
