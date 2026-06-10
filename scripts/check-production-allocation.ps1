# check-production-allocation.ps1
# P3 production allocation smoke check
# Read-only validation script - no mutation, no deployment.
#
# Usage:
#   .\scripts\check-production-allocation.ps1 -SkipGenerate
#   .\scripts\check-production-allocation.ps1
#   .\scripts\check-production-allocation.ps1 -VerboseJson
#   .\scripts\check-production-allocation.ps1 -BaseUrl http://localhost:8000/fund/api -TimeoutSeconds 30 -SkipGenerate

param(
    [string]$BaseUrl = "http://43.160.226.62/fund/api",
    [int]$TimeoutSeconds = 120,
    [switch]$SkipGenerate,
    [switch]$VerboseJson
)

$ErrorActionPreference = "Stop"
$script:FailCount = 0
$script:PassCount = 0
$script:WarnCount = 0

# -- helpers --

function Write-Step {
    param([string]$Label)
    Write-Host "`n=== $Label ===" -ForegroundColor Cyan
}

function Pass {
    param([string]$Msg)
    Write-Host "  PASS  $Msg" -ForegroundColor Green
    $script:PassCount++
}

function Warn {
    param([string]$Msg)
    Write-Host "  WARN  $Msg" -ForegroundColor Yellow
    $script:WarnCount++
}

function Fail {
    param([string]$Msg)
    Write-Host "  FAIL  $Msg" -ForegroundColor Red
    $script:FailCount++
}

function RecursiveCheckFinite {
    param($Obj, [string]$Path = "$")

    if ($null -eq $Obj) { return }

    if ($Obj -is [double] -or $Obj -is [float] -or $Obj -is [decimal]) {
        if (-not [double]::IsFinite([double]$Obj)) {
            Fail "non-finite numeric value at $Path = $Obj"
        }
    }
    elseif ($Obj -is [string]) {
        # Detect string-serialized non-finite values that JSON parsers might preserve
        if ($Obj -eq "NaN" -or $Obj -eq "Infinity" -or $Obj -eq "-Infinity") {
            Fail "non-finite string literal at $Path = '$Obj'"
        }
    }
    elseif ($Obj -is [System.Collections.IDictionary]) {
        foreach ($key in $Obj.Keys) {
            RecursiveCheckFinite -Obj $Obj[$key] -Path "$Path.$key"
        }
    }
    elseif ($Obj -is [array] -or $Obj -is [System.Collections.IList]) {
        for ($i = 0; $i -lt $Obj.Count; $i++) {
            RecursiveCheckFinite -Obj $Obj[$i] -Path "$Path[$i]"
        }
    }
    elseif ($Obj -is [System.Management.Automation.PSCustomObject]) {
        foreach ($prop in $Obj.PSObject.Properties) {
            RecursiveCheckFinite -Obj $prop.Value -Path "$Path.$($prop.Name)"
        }
    }
}

function Invoke-ApiCall {
    param(
        [string]$Method,
        [string]$Url,
        [string]$Description,
        $Body = $null
    )

    try {
        $params = @{
            Uri         = $Url
            Method      = $Method
            TimeoutSec  = $TimeoutSeconds
            ContentType = "application/json; charset=utf-8"
        }
        if ($Body) {
            $params["Body"] = ($Body | ConvertTo-Json -Compress -Depth 10)
        }
        $response = Invoke-WebRequest @params -UseBasicParsing
        return @{
            Success      = $true
            StatusCode   = $response.StatusCode
            Content      = $response.Content
            Json         = $null
            ContentType  = $response.Headers["Content-Type"]
        }
    }
    catch {
        $ex = $_.Exception
        if ($ex -is [System.Net.WebException] -and $ex.Response) {
            $resp = $ex.Response
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
            return @{
                Success    = $false
                StatusCode = [int]$resp.StatusCode
                Content    = $body
                Json       = $null
                Exception  = $ex.Message
            }
        }
        return @{
            Success    = $false
            StatusCode = $null
            Content    = $null
            Json       = $null
            Exception  = $ex.Message
        }
    }
}

function Parse-JsonBody {
    param($Result)

    if (-not $Result.Content) { return }

    try {
        $Result.Json = $Result.Content | ConvertFrom-Json -ErrorAction Stop
    }
    catch {
        # Leave Json null; caller will report the parse failure
    }
}

function Print-JsonSummary {
    param($Obj, [string]$Label = "Response")

    if (-not $VerboseJson) { return }
    if ($null -eq $Obj) { return }

    try {
        $summary = $Obj | ConvertTo-Json -Compress -Depth 4 -ErrorAction Stop
        $maxLen = 300
        if ($summary.Length -gt $maxLen) {
            $summary = $summary.Substring(0, $maxLen) + "..."
        }
        Write-Host "  [json] $Label : $summary" -ForegroundColor DarkGray
    }
    catch {
        Write-Host "  [json] $Label : <serialization failed>" -ForegroundColor DarkGray
    }
}

# -- checks --

Write-Step "1. Health Endpoint"

$health = Invoke-ApiCall -Method "GET" -Url "$BaseUrl/health" -Description "Health check"
Parse-JsonBody $health

if ($health.Success -and $health.Json) {
    if ($health.Json.status -eq "ok") {
        Pass "GET $BaseUrl/health -> status=ok"
    }
    else {
        Fail "GET $BaseUrl/health -> status='$($health.Json.status)' (expected 'ok')"
    }
    Print-JsonSummary -Obj $health.Json -Label "health"
}
elseif ($health.StatusCode) {
    Fail "GET $BaseUrl/health -> HTTP $($health.StatusCode)"
    if ($health.Content) { Write-Host "  Body: $($health.Content)" -ForegroundColor Red }
}
else {
    Fail "GET $BaseUrl/health -> connection failed: $($health.Exception)"
}

# -- market-data status --

Write-Step "2. Market-Data Status"

$mdStatus = Invoke-ApiCall -Method "GET" -Url "$BaseUrl/market-data/status" -Description "Market data status"
Parse-JsonBody $mdStatus

$script:RollingStatsAvailable = $null

if ($mdStatus.Success -and $mdStatus.Json) {
    Pass "GET $BaseUrl/market-data/status -> HTTP $($mdStatus.StatusCode), valid JSON"

    $mdHealth = $mdStatus.Json.health
    if ($mdHealth) {
        Write-Host "  market-data.health = $mdHealth" -ForegroundColor $(if ($mdHealth -eq "healthy") { "Green" } elseif ($mdHealth -eq "degraded") { "Yellow" } else { "Red" })
    }

    $rsa = $mdStatus.Json.rolling_stats_available
    if ($null -ne $rsa) {
        Write-Host "  rolling_stats_available = $rsa"
        $script:RollingStatsAvailable = $rsa
    }

    $macro = $mdStatus.Json.macro_available
    $cov = $mdStatus.Json.rolling_coverage
    $vol = $mdStatus.Json.vol_ratio

    if ($null -ne $macro) { Write-Host "  macro_available = $macro" }
    if ($null -ne $cov) { Write-Host "  rolling_coverage = $cov" }
    if ($null -ne $vol) { Write-Host "  vol_ratio = $vol" }

    Print-JsonSummary -Obj $mdStatus.Json -Label "market-data/status"
}
elseif ($mdStatus.StatusCode) {
    Warn "GET $BaseUrl/market-data/status -> HTTP $($mdStatus.StatusCode) (not fatal)"
    if ($mdStatus.Content) { Write-Host "  Body: $($mdStatus.Content)" -ForegroundColor Yellow }
}
else {
    Warn "GET $BaseUrl/market-data/status -> connection failed: $($mdStatus.Exception) (not fatal)"
}

# -- pipeline-health --

Write-Step "3. Pipeline Health"

$pipeHealth = Invoke-ApiCall -Method "GET" -Url "$BaseUrl/allocation/pipeline-health" -Description "Pipeline health"
Parse-JsonBody $pipeHealth

if ($pipeHealth.Success -and $pipeHealth.Json) {
    Pass "GET $BaseUrl/allocation/pipeline-health -> HTTP $($pipeHealth.StatusCode), valid JSON"

    $ph = $pipeHealth.Json.health
    if ($ph) {
        Write-Host "  pipeline.health = $ph" -ForegroundColor $(if ($ph -eq "healthy") { "Green" } elseif ($ph -eq "degraded") { "Yellow" } else { "Red" })
    }

    $cal = $pipeHealth.Json.calibration
    if ($cal) {
        $calHealth = $cal.health
        $calWarn = $cal.warning_count
        $calMiss = $cal.missing_count

        Write-Host "  calibration.health = $calHealth" -ForegroundColor $(if ($calHealth -eq "healthy") { "Green" } elseif ($calHealth -eq "degraded") { "Yellow" } else { "DarkGray" })
        if ($null -ne $calWarn) { Write-Host "  calibration.warning_count = $calWarn" }
        if ($null -ne $calMiss) { Write-Host "  calibration.missing_count = $calMiss" }
    }
    else {
        Write-Host "  calibration: not present in pipeline-health response" -ForegroundColor DarkGray
    }

    # History summary
    $hist = $pipeHealth.Json.history_summary
    if ($hist) {
        Write-Host "  history: $($hist.total_runs) runs, healthy=$($hist.healthy), degraded=$($hist.degraded), critical=$($hist.critical), avg=$($hist.avg_total_ms)ms"
    }

    Print-JsonSummary -Obj $pipeHealth.Json -Label "pipeline-health"
}
elseif ($pipeHealth.StatusCode) {
    Fail "GET $BaseUrl/allocation/pipeline-health -> HTTP $($pipeHealth.StatusCode)"
    if ($pipeHealth.Content) { Write-Host "  Body: $($pipeHealth.Content)" -ForegroundColor Red }
}
else {
    Fail "GET $BaseUrl/allocation/pipeline-health -> connection failed: $($pipeHealth.Exception)"
}

# -- allocation generate --

if ($SkipGenerate) {
    Write-Host "`n=== 4. Allocation Generate (SKIPPED) ===" -ForegroundColor DarkGray
    Write-Host "  Use -SkipGenerate to omit this step." -ForegroundColor DarkGray
}
else {
    Write-Step "4. Allocation Generate"

    $genBody = @{
        age            = 35
        goal_type      = "wealth"
        investment_horizon = "medium"
        amount         = 500000
        risk_tolerance = "balanced"
    }

    Write-Host "  POST $BaseUrl/allocation/generate" -ForegroundColor Gray
    Write-Host "  Request: age=35, amount=500000, risk_tolerance=balanced, horizon=medium, goal=wealth" -ForegroundColor Gray

    $gen = Invoke-ApiCall -Method "POST" -Url "$BaseUrl/allocation/generate" -Description "Allocation generate" -Body $genBody
    Parse-JsonBody $gen

    $genOk = $true

    # -- status check --
    if (-not $gen.StatusCode) {
        Fail "POST allocation/generate -> connection failed: $($gen.Exception)"
        $genOk = $false
    }
    elseif ($gen.StatusCode -ne 200) {
        $detail = ""
        if ($gen.Json -and $gen.Json.detail) {
            # FastAPI error detail
            if ($gen.Json.detail -is [string]) {
                $detail = " detail='$($gen.Json.detail)'"
            }
            else {
                try {
                    $detail = " detail=" + ($gen.Json.detail | ConvertTo-Json -Compress -Depth 4)
                } catch { $detail = " detail=<complex>" }
            }
        }
        elseif ($gen.Content) {
            $detail = " body='$($gen.Content.Substring(0, [Math]::Min(200, $gen.Content.Length)))'"
        }

        if ($gen.StatusCode -eq 401) {
            Warn "POST allocation/generate -> HTTP 401 (auth required - expected for unauthenticated smoke)$detail"
        }
        elseif ($gen.StatusCode -eq 403) {
            Warn "POST allocation/generate -> HTTP 403 (forbidden)$detail"
        }
        else {
            Fail "POST allocation/generate -> HTTP $($gen.StatusCode) (expected 200)$detail"
        }
        $genOk = $false
    }
    else {
        Pass "POST allocation/generate -> HTTP 200"
    }

    if ($genOk -and $gen.Json) {
        # -- JSON validation already passed via ConvertFrom-Json --

        # -- non-finite check --
        RecursiveCheckFinite -Obj $gen.Json

        # -- data_quality key --
        $dq = $gen.Json.data_quality
        if ($null -eq $dq) {
            Fail "allocation/generate response missing 'data_quality' key"
        }
        else {
            Pass "allocation/generate response contains 'data_quality' key"

            $dqStatus = $dq.overall_status
            if ($dqStatus) {
                Write-Host "  data_quality.overall_status = $dqStatus"
            }

            # If rolling stats unavailable, assert overall_status != "real"
            if ($script:RollingStatsAvailable -eq $false) {
                if ($dqStatus -eq "real") {
                    Fail "data_quality.overall_status='real' but rolling_stats_available is false - inconsistent"
                }
                else {
                    Pass "data_quality.overall_status != 'real' when rolling stats unavailable (correct)"
                }
            }
        }

        Print-JsonSummary -Obj $gen.Json -Label "allocation/generate"
    }

    if (-not $gen.Json -and $genOk) {
        Fail "POST allocation/generate -> response is not valid JSON"
        if ($gen.Content) {
            Write-Host "  Raw body (first 500 chars): $($gen.Content.Substring(0, [Math]::Min(500, $gen.Content.Length)))" -ForegroundColor Red
        }
    }
}

# -- summary --

Write-Host "`n========================================" -ForegroundColor White
Write-Host "  SMOKE RESULTS" -ForegroundColor White
Write-Host "========================================" -ForegroundColor White
Write-Host "  PASS: $script:PassCount" -ForegroundColor Green
Write-Host "  WARN: $script:WarnCount" -ForegroundColor Yellow
Write-Host "  FAIL: $script:FailCount" -ForegroundColor Red

if ($SkipGenerate) {
    Write-Host "  (Generate step skipped)" -ForegroundColor DarkGray
}

if ($script:FailCount -gt 0) {
    Write-Host "`nSMOKE CHECK: SOME CHECKS FAILED" -ForegroundColor Red
    exit 1
}
else {
    Write-Host "`nSMOKE CHECK: ALL CHECKS PASSED" -ForegroundColor Green
    exit 0
}
