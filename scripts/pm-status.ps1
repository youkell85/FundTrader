[CmdletBinding()]
param(
    [string]$TaskId,
    [int]$Tail = 30
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function ConvertTo-RepoRelative {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )
    $full = (Resolve-Path -LiteralPath $Path).Path
    if ($full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $full.Substring($Root.Length).TrimStart("\", "/")
    }
    return $full
}

function Show-Latest {
    param(
        [Parameter(Mandatory = $true)][string]$Label,
        [Parameter(Mandatory = $true)][string]$Dir,
        [string]$Filter = "*"
    )

    Write-Host ""
    Write-Host "== $Label =="
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
        Write-Host "Missing: $Dir"
        return
    }

    $items = @(Get-ChildItem -LiteralPath $Dir -Filter $Filter -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 10)

    if ($items.Count -eq 0) {
        Write-Host "(empty)"
        return
    }

    $items | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
}

function Find-TaskFiles {
    param(
        [Parameter(Mandatory = $true)][string]$Dir,
        [Parameter(Mandatory = $true)][string]$Pattern
    )
    if (-not (Test-Path -LiteralPath $Dir -PathType Container)) {
        return @()
    }
    return @(Get-ChildItem -LiteralPath $Dir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like "*$Pattern*" } |
        Sort-Object LastWriteTime -Descending)
}

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$outboxDir = Join-Path $pmDir "outbox"
$runningDir = Join-Path $pmDir "running"
$reportsDir = Join-Path $pmDir "reports"
$logsDir = Join-Path $pmDir "logs"
$archiveDir = Join-Path $pmDir "archive"
$reviewsDir = Join-Path $pmDir "reviews"

if ([string]::IsNullOrWhiteSpace($TaskId)) {
    Write-Host "PM status for $root"
    Show-Latest -Label "Outbox" -Dir $outboxDir -Filter "*.md"
    Show-Latest -Label "Running locks" -Dir $runningDir -Filter "*.json"
    Show-Latest -Label "Reports" -Dir $reportsDir -Filter "*.md"
    Show-Latest -Label "Reviews" -Dir $reviewsDir -Filter "*.md"
    Show-Latest -Label "Logs" -Dir $logsDir -Filter "*.jsonl"
    Show-Latest -Label "Archive" -Dir $archiveDir -Filter "*.md"
    exit 0
}

Write-Host "PM task status: $TaskId"
$groups = [ordered]@{
    Outbox  = Find-TaskFiles -Dir $outboxDir -Pattern $TaskId
    Running = Find-TaskFiles -Dir $runningDir -Pattern $TaskId
    Reports = Find-TaskFiles -Dir $reportsDir -Pattern $TaskId
    Reviews = Find-TaskFiles -Dir $reviewsDir -Pattern $TaskId
    Logs    = Find-TaskFiles -Dir $logsDir -Pattern $TaskId
    Archive = Find-TaskFiles -Dir $archiveDir -Pattern $TaskId
}

foreach ($entry in $groups.GetEnumerator()) {
    Write-Host ""
    Write-Host "== $($entry.Key) =="
    if ($entry.Value.Count -eq 0) {
        Write-Host "(none)"
        continue
    }
    foreach ($file in $entry.Value) {
        Write-Host (ConvertTo-RepoRelative -Path $file.FullName -Root $root)
    }
}

$report = $groups["Reports"] | Select-Object -First 1
if ($report) {
    Write-Host ""
    Write-Host "== Report tail =="
    Get-Content -LiteralPath $report.FullName -Tail $Tail
}

$log = $groups["Logs"] | Select-Object -First 1
if ($log) {
    Write-Host ""
    Write-Host "== Log tail =="
    Get-Content -LiteralPath $log.FullName -Tail $Tail
}

