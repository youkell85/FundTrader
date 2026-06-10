[CmdletBinding()]
param(
    [string]$TaskId,
    [int]$SinceDays = 0,
    [int]$Top = 0,
    [switch]$AsJson,
    [switch]$IncludeFailures
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$logsDir = Join-Path $pmDir "logs"
$reportsDir = Join-Path $pmDir "reports"
$reviewsDir = Join-Path $pmDir "reviews"

if (-not (Test-Path -LiteralPath $logsDir -PathType Container)) {
    if ($AsJson) {
        Write-Host '{"generatedAt":"' (Get-Date).ToString("o") '","totals":{},"items":[]}' -NoNewline
    } else {
        Write-Host "No logs directory found: $logsDir"
    }
    exit 0
}

# Collect log files
$logFiles = @(Get-ChildItem -LiteralPath $logsDir -Filter "*.jsonl" -File -ErrorAction SilentlyContinue)

# Filter by TaskId substring
if (-not [string]::IsNullOrWhiteSpace($TaskId)) {
    $logFiles = @($logFiles | Where-Object { $_.Name -like "*$TaskId*" })
}

# Filter by last write time
if ($SinceDays -gt 0) {
    $cutoff = (Get-Date).AddDays(-$SinceDays)
    $logFiles = @($logFiles | Where-Object { $_.LastWriteTime -ge $cutoff })
}

# Sort by last write time descending
$logFiles = @($logFiles | Sort-Object LastWriteTime -Descending)

# Apply Top limit
if ($Top -gt 0) {
    $logFiles = @($logFiles | Select-Object -First $Top)
}

if ($logFiles.Count -eq 0) {
    if ($AsJson) {
        $out = [ordered]@{
            generatedAt = (Get-Date).ToString("o")
            totals = @{}
            items = @()
        }
        Write-Host ($out | ConvertTo-Json -Depth 3) -NoNewline
    } else {
        Write-Host "No matching log files found."
    }
    exit 0
}

# Read UTF-16 encoded JSONL (Claude Code writes UTF-16 LE with BOM)
function Read-JsonlUtf16 {
    param([Parameter(Mandatory = $true)][string]$Path)
    $encoding = [System.Text.UnicodeEncoding]::new($true, $false) # UTF-16 LE BOM
    $lines = [System.IO.File]::ReadAllLines($Path, $encoding)
    return $lines
}

$results = [System.Collections.Generic.List[object]]::new()
$totalCost = 0.0
$totalDurationMin = 0.0
$totalTurns = 0
$totalInputTokens = 0L
$totalOutputTokens = 0L

foreach ($logFile in $logFiles) {
    $taskIdExtracted = [System.IO.Path]::GetFileNameWithoutExtension($logFile.Name)
    $logSize = $logFile.Length
    $lastWrite = $logFile.LastWriteTime

    # Check for corresponding report and review
    $reportPath = Join-Path $reportsDir "$taskIdExtracted.md"
    $reviewPath = Join-Path $reviewsDir "$taskIdExtracted.review.md"
    $reportExists = Test-Path -LiteralPath $reportPath -PathType Leaf
    $reviewExists = Test-Path -LiteralPath $reviewPath -PathType Leaf

    try {
        $logLines = Read-JsonlUtf16 -Path $logFile.FullName
    } catch {
        # Skip unreadable files
        if ($IncludeFailures) {
            $results.Add([ordered]@{
                taskId = $taskIdExtracted
                duration_minutes = $null
                num_turns = $null
                total_cost_usd = $null
                input_tokens = $null
                output_tokens = $null
                stop_reason = $null
                subtype = $null
                is_error = $null
                log_size_bytes = $logSize
                last_write = $lastWrite.ToString("o")
                report_exists = $reportExists
                review_exists = $reviewExists
                status = "unreadable"
            })
        }
        continue
    }

    # Find the last result line
    $resultLine = $null
    for ($i = $logLines.Count - 1; $i -ge 0; $i--) {
        $line = $logLines[$i]
        if (-not [string]::IsNullOrWhiteSpace($line) -and $line.Contains('"type":"result"')) {
            $resultLine = $line
            break
        }
    }

    if (-not $resultLine) {
        if ($IncludeFailures) {
            $results.Add([ordered]@{
                taskId = $taskIdExtracted
                duration_minutes = $null
                num_turns = $null
                total_cost_usd = $null
                input_tokens = $null
                output_tokens = $null
                stop_reason = $null
                subtype = $null
                is_error = $null
                log_size_bytes = $logSize
                last_write = $lastWrite.ToString("o")
                report_exists = $reportExists
                review_exists = $reviewExists
                status = "incomplete"
            })
        }
        continue
    }

    try {
        $result = $resultLine | ConvertFrom-Json

        # Extract duration from duration_ms (preferred) or duration_seconds
        $durationMin = $null
        if ($result.duration_ms) {
            $durationMin = [math]::Round($result.duration_ms / 60000.0, 1)
        } elseif ($result.duration_seconds) {
            $durationMin = [math]::Round($result.duration_seconds / 60.0, 1)
        } elseif ($result.duration) {
            $durationMin = [math]::Round([double]$result.duration / 60.0, 1)
        }

        $inputTokens = 0L
        $outputTokens = 0L
        if ($result.usage) {
            if ($result.usage.input_tokens) { $inputTokens = [long]$result.usage.input_tokens }
            if ($result.usage.output_tokens) { $outputTokens = [long]$result.usage.output_tokens }
        }

        $cost = $null
        if ($result.total_cost_usd) { $cost = [double]$result.total_cost_usd }

        $item = [ordered]@{
            taskId = $taskIdExtracted
            duration_minutes = $durationMin
            num_turns = if ($result.num_turns) { [int]$result.num_turns } else { $null }
            total_cost_usd = $cost
            input_tokens = if ($inputTokens -gt 0) { $inputTokens } else { $null }
            output_tokens = if ($outputTokens -gt 0) { $outputTokens } else { $null }
            stop_reason = [string]$result.stop_reason
            subtype = [string]$result.subtype
            is_error = if ($result.is_error) { [bool]$result.is_error } else { $false }
            log_size_bytes = $logSize
            last_write = $lastWrite.ToString("o")
            report_exists = $reportExists
            review_exists = $reviewExists
            status = "complete"
        }

        $results.Add($item)

        if ($durationMin) { $totalDurationMin += $durationMin }
        if ($cost) { $totalCost += $cost }
        if ($result.num_turns) { $totalTurns += [int]$result.num_turns }
        $totalInputTokens += $inputTokens
        $totalOutputTokens += $outputTokens
    } catch {
        if ($IncludeFailures) {
            $results.Add([ordered]@{
                taskId = $taskIdExtracted
                duration_minutes = $null
                num_turns = $null
                total_cost_usd = $null
                input_tokens = $null
                output_tokens = $null
                stop_reason = $null
                subtype = $null
                is_error = $null
                log_size_bytes = $logSize
                last_write = $lastWrite.ToString("o")
                report_exists = $reportExists
                review_exists = $reviewExists
                status = "parse_error"
            })
        }
    }
}

$totals = [ordered]@{
    total_cost_usd = [math]::Round($totalCost, 4)
    total_duration_minutes = [math]::Round($totalDurationMin, 1)
    total_turns = $totalTurns
    total_input_tokens = $totalInputTokens
    total_output_tokens = $totalOutputTokens
}

if ($AsJson) {
    $output = [ordered]@{
        generatedAt = (Get-Date).ToString("o")
        totals = $totals
        items = $results.ToArray()
    }
    $json = $output | ConvertTo-Json -Depth 4
    Write-Host $json
    exit 0
}

# Table output
$displayItems = $results.ToArray() | ForEach-Object { [PSCustomObject]$_ } | Select-Object taskId, duration_minutes, num_turns, total_cost_usd, input_tokens, output_tokens, stop_reason, status

Write-Host "PM Cost Summary"
Write-Host "================"
Write-Host ""
$displayItems | Format-Table -AutoSize

Write-Host "---"
Write-Host "Totals:"
Write-Host "  Cost:     `$$($totals.total_cost_usd)"
Write-Host "  Duration:  $($totals.total_duration_minutes) min"
Write-Host "  Turns:     $($totals.total_turns)"
Write-Host "  Input:     $($totals.total_input_tokens) tokens"
Write-Host "  Output:    $($totals.total_output_tokens) tokens"
Write-Host "  Logs:      $($results.Count) complete"
Write-Host ""