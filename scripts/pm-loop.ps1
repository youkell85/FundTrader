[CmdletBinding()]
param(
    [string]$Task,

    [int]$MaxRounds = 3,

    [int]$MaxMinutes = 120,

    [string]$ClaudeCommand = "claude",

    [string]$Model = $env:PM_CLAUDE_MODEL,

    [string]$PermissionMode = "acceptEdits",

    [switch]$ArchiveOnPass,

    [switch]$DryRun,

    [switch]$Force
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

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-NewestOutboxTask {
    param(
        [Parameter(Mandatory = $true)][string]$OutboxDir
    )
    $latest = @(Get-ChildItem -LiteralPath $OutboxDir -Filter "*.md" -File -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1)
    if ($latest.Count -eq 0) {
        return $null
    }
    return $latest[0].FullName
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

# --- Main ---

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$outboxDir = Join-Path $pmDir "outbox"
$reviewDir = Join-Path $pmDir "reviews"
$archiveDir = Join-Path $pmDir "archive"

Ensure-Dir -Path $reviewDir
Ensure-Dir -Path $archiveDir

$loopStart = Get-Date
$round = 0

Write-Host "PM Loop started at $($loopStart.ToString('o'))"
Write-Host "MaxRounds: $MaxRounds, MaxMinutes: $MaxMinutes"
if ($DryRun) {
    Write-Host "Mode: DRY RUN (no Claude dispatch)"
}
Write-Host ""

while ($round -lt $MaxRounds) {
    $elapsed = ((Get-Date) - $loopStart).TotalMinutes
    if ($elapsed -ge $MaxMinutes) {
        Write-Host "Time limit reached ($MaxMinutes minutes). Stopping loop."
        break
    }

    $round++
    Write-Host "=== Round $round of $MaxRounds ==="

    # Choose current task
    if ($round -eq 1 -and -not [string]::IsNullOrWhiteSpace($Task)) {
        $currentTaskPath = if ([System.IO.Path]::IsPathRooted($Task)) {
            $Task
        } else {
            Join-Path $root $Task
        }
        if (-not (Test-Path -LiteralPath $currentTaskPath -PathType Leaf)) {
            Write-Warning "Task not found: $currentTaskPath"
            break
        }
        $currentTaskPath = (Resolve-Path -LiteralPath $currentTaskPath).Path
    } else {
        $nextTask = Get-NewestOutboxTask -OutboxDir $outboxDir
        if (-not $nextTask) {
            Write-Host "No more tasks in outbox. Loop complete."
            break
        }
        $currentTaskPath = $nextTask
    }

    $taskId = [System.IO.Path]::GetFileNameWithoutExtension($currentTaskPath)
    $taskRel = ConvertTo-RepoRelative -Path $currentTaskPath -Root $root

    Write-Host "Task: $taskRel"

    # Write baseline git status snapshot
    $baselinePath = Join-Path $reviewDir "$taskId.baseline.status.txt"
    Push-Location $root
    try {
        git status --short --untracked-files=all 2>&1 | Out-File -FilePath $baselinePath -Encoding utf8
    } finally {
        Pop-Location
    }
    Write-Host "Baseline: $baselinePath"

    if ($DryRun) {
        Write-Host "[DryRun] Would dispatch: $taskRel"
        Write-Host "[DryRun] Would review with baseline: $baselinePath"
        Write-Host "[DryRun] Round $round complete (dry)."
        Write-Host ""
        # In dry run, don't actually dispatch or review — just move to next round
        # But we need to simulate: in dry run with a single explicit task, stop after one round
        if (-not [string]::IsNullOrWhiteSpace($Task)) {
            # Explicit task provided: only one round in dry run
            Write-Host "Dry run complete (explicit task, 1 round)."
            break
        }
        continue
    }

    # Dispatch
    $dispatchArgs = @(
        "-Task", $currentTaskPath,
        "-ClaudeCommand", $ClaudeCommand,
        "-PermissionMode", $PermissionMode
    )
    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        $dispatchArgs += @("-Model", $Model)
    }
    if ($Force) {
        $dispatchArgs += "-Force"
    }

    Write-Host "Dispatching..."
    $dispatchScript = Join-Path $root "scripts\pm-dispatch.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $dispatchScript @dispatchArgs
    $dispatchExit = $LASTEXITCODE

    if ($dispatchExit -ne 0) {
        Write-Warning "Dispatch exited with code $dispatchExit. Stopping loop."
        break
    }

    # Review
    Write-Host "Reviewing..."
    $reviewScript = Join-Path $root "scripts\pm-review.ps1"
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $reviewScript -Task $currentTaskPath -BaselineStatus $baselinePath
    $reviewExit = $LASTEXITCODE

    $reviewMdPath = Join-Path $reviewDir "$taskId.review.md"
    $briefScript = Join-Path $root "scripts\pm-brief.ps1"
    if (Test-Path -LiteralPath $briefScript -PathType Leaf) {
        Write-Host ""
        Write-Host "Brief..."
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $briefScript -Task $currentTaskPath
        Write-Host ""
    }

    switch ($reviewExit) {
        0 {
            Write-Host "Review: PASS"
            if ($ArchiveOnPass) {
                $archivePath = Join-Path $archiveDir ([System.IO.Path]::GetFileName($currentTaskPath))
                Move-Item -LiteralPath $currentTaskPath -Destination $archivePath -Force
                Write-Host "Archived: $archivePath"
            }
            # Continue to next round
            Write-Host ""
            continue
        }
        2 {
            Write-Host "Review: NEEDS_FIX — stopping loop."
            Write-Host "Review artifact: $reviewMdPath"
            break
        }
        3 {
            Write-Host "Review: BLOCKED — stopping loop."
            Write-Host "Review artifact: $reviewMdPath"
            break
        }
        default {
            Write-Warning "Review exited with unexpected code $reviewExit. Stopping loop."
            break
        }
    }
}

$loopEnd = Get-Date
$totalMinutes = [math]::Round(($loopEnd - $loopStart).TotalMinutes, 1)
Write-Host ""
Write-Host "PM Loop finished at $($loopEnd.ToString('o'))"
Write-Host "Rounds completed: $round"
Write-Host "Total time: $totalMinutes minutes"
Write-Host ""
Write-Host "Safety confirmation: no commit, no push, no deploy, no git add."
