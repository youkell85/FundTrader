[CmdletBinding()]
param(
    [string]$Task,

    [string]$TaskId,

    [switch]$AsJson
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

function Find-TaskPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$OutboxDir,
        [string]$Task,
        [string]$TaskId
    )

    if (-not [string]::IsNullOrWhiteSpace($Task)) {
        $candidate = if ([System.IO.Path]::IsPathRooted($Task)) {
            $Task
        } else {
            Join-Path $Root $Task
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Task file not found: $candidate"
        }
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    if (-not [string]::IsNullOrWhiteSpace($TaskId)) {
        $matches = @(Get-ChildItem -LiteralPath $OutboxDir -Filter "*.md" -File -ErrorAction SilentlyContinue |
            Where-Object { $_.BaseName -like "*$TaskId*" } |
            Sort-Object LastWriteTime -Descending)
        if ($matches.Count -eq 0) {
            throw "No outbox task matched TaskId: $TaskId"
        }
        return $matches[0].FullName
    }

    $latest = @(Get-ChildItem -LiteralPath $OutboxDir -Filter "*.md" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1)
    if ($latest.Count -eq 0) {
        throw "No outbox tasks found."
    }
    return $latest[0].FullName
}

function Get-FileInfoObject {
    param(
        [string]$Path,
        [Parameter(Mandatory = $true)][string]$Root
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [ordered]@{
            exists = $false
            path = $null
            bytes = 0
            lastWrite = $null
        }
    }

    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        exists = $true
        path = ConvertTo-RepoRelative -Path $item.FullName -Root $Root
        bytes = $item.Length
        lastWrite = $item.LastWriteTime.ToString("o")
    }
}

function Normalize-DigestKey {
    param([Parameter(Mandatory = $true)][string]$Key)
    return ($Key.Trim().ToLowerInvariant() -replace '[^a-z0-9]+', '_').Trim("_")
}

function Parse-PmDigest {
    param([string]$ReportPath)

    $empty = [ordered]@{
        found = $false
        values = [ordered]@{}
        raw = @()
    }

    if ([string]::IsNullOrWhiteSpace($ReportPath) -or -not (Test-Path -LiteralPath $ReportPath -PathType Leaf)) {
        return $empty
    }

    $lines = Get-Content -LiteralPath $ReportPath -ErrorAction SilentlyContinue
    $inDigest = $false
    $raw = [System.Collections.Generic.List[string]]::new()
    $values = [ordered]@{}

    foreach ($line in $lines) {
        if ($line -match '^##\s+PM\s+Digest\s*$') {
            $inDigest = $true
            continue
        }

        if ($inDigest -and $line -match '^##\s+') {
            break
        }

        if (-not $inDigest) {
            continue
        }

        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        [void]$raw.Add($line)
        if ($line -match '^\s*[-*]?\s*([A-Za-z][A-Za-z0-9 _/-]{0,40})\s*:\s*(.*?)\s*$') {
            $key = Normalize-DigestKey -Key $Matches[1]
            $value = $Matches[2]
            if ($values.Contains($key)) {
                $values[$key] = "$($values[$key]); $value"
            } else {
                $values[$key] = $value
            }
        }
    }

    return [ordered]@{
        found = $raw.Count -gt 0
        values = $values
        raw = $raw.ToArray()
    }
}

function Read-JsonFile {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    try {
        return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Get-PropValue {
    param(
        [object]$Object,
        [string]$Name,
        [object]$Default = $null
    )
    if ($null -eq $Object) {
        return $Default
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) {
        return $Default
    }
    return $prop.Value
}

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$outboxDir = Join-Path $pmDir "outbox"
$reportsDir = Join-Path $pmDir "reports"
$reviewsDir = Join-Path $pmDir "reviews"
$logsDir = Join-Path $pmDir "logs"

$taskPath = Find-TaskPath -Root $root -OutboxDir $outboxDir -Task $Task -TaskId $TaskId
$resolvedTaskId = [System.IO.Path]::GetFileNameWithoutExtension($taskPath)

$reportPath = Join-Path $reportsDir "$resolvedTaskId.md"
$reviewJsonPath = Join-Path $reviewsDir "$resolvedTaskId.review.json"
$acceptJsonPath = Join-Path $reviewsDir "$resolvedTaskId.acceptance.json"
$logPath = Join-Path $logsDir "$resolvedTaskId.jsonl"

$review = Read-JsonFile -Path $reviewJsonPath
$acceptance = Read-JsonFile -Path $acceptJsonPath
$digest = Parse-PmDigest -ReportPath $reportPath

$acceptSummary = if ($null -ne $acceptance) {
    Get-PropValue -Object $acceptance -Name "summary"
} else {
    $null
}

$brief = [ordered]@{
    taskId = $resolvedTaskId
    taskPath = ConvertTo-RepoRelative -Path $taskPath -Root $root
    pmDigest = $digest
    review = [ordered]@{
        exists = $null -ne $review
        status = Get-PropValue -Object $review -Name "status"
        issues = @(Get-PropValue -Object $review -Name "issues" -Default @())
        newlyChanged = @(Get-PropValue -Object $review -Name "newlyChanged" -Default @())
        recommendedNext = Get-PropValue -Object $review -Name "recommendedNext"
    }
    acceptance = [ordered]@{
        exists = $null -ne $acceptance
        mode = Get-PropValue -Object $acceptance -Name "mode"
        summary = $acceptSummary
        recommendedNext = Get-PropValue -Object $acceptance -Name "recommendedNext"
    }
    artifacts = [ordered]@{
        report = Get-FileInfoObject -Path $reportPath -Root $root
        reviewJson = Get-FileInfoObject -Path $reviewJsonPath -Root $root
        acceptanceJson = Get-FileInfoObject -Path $acceptJsonPath -Root $root
        log = Get-FileInfoObject -Path $logPath -Root $root
    }
}

if ($AsJson) {
    $brief | ConvertTo-Json -Depth 6
    exit 0
}

Write-Host "PM Brief: $resolvedTaskId"
Write-Host "Task: $($brief.taskPath)"
Write-Host ""

Write-Host "== PM Digest =="
if ($digest.found) {
    foreach ($line in $digest.raw) {
        Write-Host $line
    }
} else {
    Write-Host "(missing)"
}

Write-Host ""
Write-Host "== Review =="
Write-Host "Exists: $($brief.review.exists)"
Write-Host "Status: $($brief.review.status)"
if ($brief.review.issues.Count -gt 0) {
    Write-Host "Issues:"
    foreach ($issue in $brief.review.issues) {
        Write-Host "  - $issue"
    }
} else {
    Write-Host "Issues: none"
}
if ($brief.review.newlyChanged.Count -gt 0) {
    Write-Host "Newly changed:"
    foreach ($item in $brief.review.newlyChanged) {
        Write-Host "  $item"
    }
} else {
    Write-Host "Newly changed: none"
}
Write-Host "Next: $($brief.review.recommendedNext)"

Write-Host ""
Write-Host "== Acceptance =="
Write-Host "Exists: $($brief.acceptance.exists)"
Write-Host "Mode: $($brief.acceptance.mode)"
if ($null -ne $brief.acceptance.summary) {
    $summary = $brief.acceptance.summary
    Write-Host "Blocks: total=$($summary.totalBlocks), safe=$($summary.safe), skipped=$($summary.skipped_unsafe), unsupported=$($summary.unsupported), passed=$($summary.passed), failed=$($summary.failed)"
} else {
    Write-Host "Blocks: n/a"
}
Write-Host "Next: $($brief.acceptance.recommendedNext)"

Write-Host ""
Write-Host "== Artifacts =="
foreach ($entry in $brief.artifacts.GetEnumerator()) {
    $info = $entry.Value
    if ($info.exists) {
        Write-Host "$($entry.Key): $($info.path) ($($info.bytes) bytes)"
    } else {
        Write-Host "$($entry.Key): missing"
    }
}
