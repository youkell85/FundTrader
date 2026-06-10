[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Task,

    [string]$ReviewDir,

    [string]$BaselineStatus,

    [int]$Tail = 40,

    [switch]$AsJson
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

function Ensure-Dir {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        New-Item -ItemType Directory -Path $Path | Out-Null
    }
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

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Parse-AllowedFiles {
    param(
        [Parameter(Mandatory = $true)][string]$TaskPath
    )

    $content = Get-Content -LiteralPath $TaskPath -Raw -ErrorAction SilentlyContinue
    if (-not $content) {
        return @{ found = $false; paths = @() }
    }

    # Match "## Allowed Files" section: bullet lines with backtick-wrapped paths
    $inSection = $false
    $paths = [System.Collections.Generic.List[string]]::new()

    foreach ($line in ($content -split "`r?`n")) {
        if ($line -match '^##\s+Allowed\s+Files') {
            $inSection = $true
            continue
        }
        if ($inSection -and $line -match '^##\s') {
            break
        }
        if ($inSection) {
            # Match bullet lines like: - `scripts/pm-loop.ps1`
            if ($line -match '^\s*-\s*`([^`]+)`') {
                [void]$paths.Add($Matches[1])
            }
        }
    }

    return @{
        found  = $paths.Count -gt 0
        paths  = $paths.ToArray()
    }
}

function Test-PathInAllowedScope {
    param(
        [Parameter(Mandatory = $true)][string]$ChangedPath,
        [Parameter(Mandatory = $true)][string[]]$AllowedPaths
    )

    if ($AllowedPaths.Count -eq 0) { return $false }

    foreach ($allowed in $AllowedPaths) {
        # Simple glob: convert * to regex wildcard
        $pattern = [regex]::Escape($allowed).Replace('\*', '.*')
        if ($ChangedPath -match "^$pattern") {
            return $true
        }
        # Also match if changed path ends with the allowed path (relative match)
        if ($ChangedPath.EndsWith($allowed, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $true
        }
    }
    return $false
}

# --- Main ---

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$reportsDir = Join-Path $pmDir "reports"
$logsDir = Join-Path $pmDir "logs"
$runningDir = Join-Path $pmDir "running"

if (-not [string]::IsNullOrWhiteSpace($ReviewDir)) {
    $reviewDir = if ([System.IO.Path]::IsPathRooted($ReviewDir)) {
        $ReviewDir
    } else {
        Join-Path $root $ReviewDir
    }
} else {
    $reviewDir = Join-Path $pmDir "reviews"
}

Ensure-Dir -Path $reviewDir

# Resolve task path
$taskPath = if ([System.IO.Path]::IsPathRooted($Task)) {
    $Task
} else {
    Join-Path $root $Task
}

if (-not (Test-Path -LiteralPath $taskPath -PathType Leaf)) {
    $status = "blocked"
    $issues = @("Task file not found: $taskPath")
    $taskId = "UNKNOWN"
} else {
    $taskPath = (Resolve-Path -LiteralPath $taskPath).Path
    $taskId = [System.IO.Path]::GetFileNameWithoutExtension($taskPath)
}

$taskRel = if (Test-Path -LiteralPath $taskPath -PathType Leaf) {
    ConvertTo-RepoRelative -Path $taskPath -Root $root
} else {
    $taskPath
}

$reportPath = Join-Path $reportsDir "$taskId.md"
$logPath = Join-Path $logsDir "$taskId.jsonl"
$lockPath = Join-Path $runningDir "$taskId.lock.json"

$reportRel = if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
    ConvertTo-RepoRelative -Path $reportPath -Root $root
} else {
    "$taskId.md (not found)"
}

$logRel = if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    ConvertTo-RepoRelative -Path $logPath -Root $root
} else {
    "$taskId.jsonl (not found)"
}

$lockRel = if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
    ConvertTo-RepoRelative -Path $lockPath -Root $root
} else {
    "$taskId.lock.json (not found)"
}

$issues = [System.Collections.Generic.List[string]]::new()

# Check: task file exists
if ($status -eq "blocked" -and $taskId -eq "UNKNOWN") {
    # Already blocked above
} elseif (-not (Test-Path -LiteralPath $taskPath -PathType Leaf)) {
    $status = "blocked"
    [void]$issues.Add("Task file missing: $taskPath")
}

# Check: report exists
$reportExists = Test-Path -LiteralPath $reportPath -PathType Leaf
if (-not $reportExists -and $status -ne "blocked") {
    $status = "blocked"
    [void]$issues.Add("Report not found: $reportPath")
}

# Check: running lock still exists
$lockExists = Test-Path -LiteralPath $lockPath -PathType Leaf
if ($lockExists -and $status -ne "blocked") {
    $status = "blocked"
    [void]$issues.Add("Running lock still exists: $lockPath")
}

# Parse allowed files
$allowedInfo = if (Test-Path -LiteralPath $taskPath -PathType Leaf) {
    Parse-AllowedFiles -TaskPath $taskPath
} else {
    @{ found = $false; paths = @() }
}

if (-not $allowedInfo.found -and $status -ne "blocked") {
    $status = "blocked"
    [void]$issues.Add("Allowed Files section not found or empty in task. Cannot verify scope.")
}

# Collect current git status
Push-Location $root
try {
    $currentStatusRaw = git status --short --untracked-files=all 2>&1 | Out-String
    $currentStatusLines = @($currentStatusRaw -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
} finally {
    Pop-Location
}

# Compare with baseline if provided
$newlyChanged = @()
if (-not [string]::IsNullOrWhiteSpace($BaselineStatus) -and (Test-Path -LiteralPath $BaselineStatus -PathType Leaf)) {
    $baselineLines = @(Get-Content -LiteralPath $BaselineStatus | Where-Object { $_.Trim() -ne "" })
    $baselineSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($bl in $baselineLines) {
        [void]$baselineSet.Add($bl.Trim())
    }
    foreach ($cl in $currentStatusLines) {
        if (-not $baselineSet.Contains($cl.Trim())) {
            $newlyChanged += $cl.Trim()
        }
    }
}

# Run git diff --check
# Temporarily relax ErrorActionPreference so that git stderr warnings
# (e.g. CRLF) are captured as output instead of thrown as terminating
# NativeCommandError. The real git exit code is preserved for the check.
Push-Location $root
$oldEAP = $ErrorActionPreference
try {
    $ErrorActionPreference = "Continue"
    $lines = & git diff --check 2>&1
    $diffCheckExit = $LASTEXITCODE
    $diffCheckOutput = ($lines | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
} finally {
    $ErrorActionPreference = $oldEAP
    Pop-Location
}

$diffCheckPassed = ($diffCheckExit -eq 0)

# Determine status if not already blocked
if ($status -ne "blocked") {
    # Check for newly changed files outside allowed scope
    $outOfScope = [System.Collections.Generic.List[string]]::new()
    if ($newlyChanged.Count -gt 0) {
        foreach ($nc in $newlyChanged) {
            # Extract path from git status line (strip status flags)
            $pathOnly = $nc -replace '^\s*\S+\s+', ''
            if (-not (Test-PathInAllowedScope -ChangedPath $pathOnly -AllowedPaths $allowedInfo.paths)) {
                [void]$outOfScope.Add($pathOnly)
            }
        }
    }

    if (-not $diffCheckPassed) {
        $status = "needs_fix"
        [void]$issues.Add("git diff --check failed. Output: $($diffCheckOutput.Trim())")
    }

    if ($outOfScope.Count -gt 0) {
        $status = "needs_fix"
        [void]$issues.Add("Files changed outside allowed scope: $($outOfScope -join ', ')")
    }

    # If no issues so far, it's a pass
    if ($issues.Count -eq 0) {
        $status = "pass"
    }
}

# Collect log metadata (not raw content)
$logInfo = ""
if (Test-Path -LiteralPath $logPath -PathType Leaf) {
    $logFile = Get-Item -LiteralPath $logPath
    $logInfo = "Log: $logRel, Size: $($logFile.Length) bytes, LastWrite: $($logFile.LastWriteTime.ToString('o'))"
} else {
    $logInfo = "Log: not found"
}

# Write review JSON
$reviewJson = [ordered]@{
    taskId          = $taskId
    status          = $status
    reviewedAt      = (Get-Date).ToString("o")
    taskPath        = $taskRel
    reportPath      = $reportRel
    logPath         = $logRel
    lockPath        = $lockRel
    reportExists    = $reportExists
    lockExists      = $lockExists
    diffCheckPassed = $diffCheckPassed
    diffCheckOutput = $diffCheckOutput.Trim()
    allowedFiles    = $allowedInfo.paths
    allowedFound    = $allowedInfo.found
    newlyChanged    = $newlyChanged
    issues          = $issues.ToArray()
    recommendedNext = if ($status -eq "pass") { "Ready for next task or archive." }
                      elseif ($status -eq "needs_fix") { "Review issues above. Codex PM should decide: hotfix task or manual fix." }
                      else { "Unblock prerequisites (report, lock, scope) before re-dispatching." }
}

$reviewJsonPath = Join-Path $reviewDir "$taskId.review.json"
Write-Utf8NoBom -Path $reviewJsonPath -Content ($reviewJson | ConvertTo-Json -Depth 4)

# Write review markdown
$reviewMd = @"
# Review: $taskId

**Status:** `$status`
**Reviewed:** $($reviewJson.reviewedAt)

## Paths

| Artifact | Path |
|----------|------|
| Task     | $taskRel |
| Report   | $reportRel |
| Log      | $logRel |
| Lock     | $lockRel |

## Git Diff Check

**Passed:** $diffCheckPassed

```
$($diffCheckOutput.Trim())
```

## Allowed Files (parsed from task)

$($allowedInfo.paths -join "`n")

## Newly Changed Files (vs baseline)

$($newlyChanged -join "`n")

## Issues

$($issues -join "`n")

## Recommended Next Action

$($reviewJson.recommendedNext)

---

$logInfo
"@

$reviewMdPath = Join-Path $reviewDir "$taskId.review.md"
Write-Utf8NoBom -Path $reviewMdPath -Content $reviewMd

# Output
if ($AsJson) {
    $reviewJson | ConvertTo-Json -Depth 4
} else {
    Write-Host "Review: $taskId"
    Write-Host "Status: $status"
    Write-Host "Review MD: $reviewMdPath"
    Write-Host "Review JSON: $reviewJsonPath"
    if ($issues.Count -gt 0) {
        Write-Host ""
        Write-Host "Issues:"
        foreach ($issue in $issues) {
            Write-Host "  - $issue"
        }
    }
    Write-Host ""
    Write-Host "Recommended: $($reviewJson.recommendedNext)"
}

# Exit codes
switch ($status) {
    "pass"      { exit 0 }
    "needs_fix" { exit 2 }
    "blocked"   { exit 3 }
    default     { exit 3 }
}
