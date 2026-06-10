[CmdletBinding()]
param(
    [string]$Task,
    [string]$ClaudeCommand = "claude",
    [string]$Model = $env:PM_CLAUDE_MODEL,
    [string]$PermissionMode = "acceptEdits",
    [int]$MaxTurns = 0,
    [switch]$DryRun,
    [switch]$Force,
    [switch]$ArchiveOnSuccess,
    [switch]$SkipGatewayPreflight,
    [switch]$RequireGatewayModels
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

function Resolve-TaskFile {
    param(
        [string]$TaskValue,
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$OutboxDir
    )

    if ([string]::IsNullOrWhiteSpace($TaskValue)) {
        $latest = @(Get-ChildItem -LiteralPath $OutboxDir -Filter "*.md" -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending |
            Select-Object -First 1)
        if ($latest.Count -eq 0) {
            throw "No handoff found in $OutboxDir. Create one with scripts\pm-new-task.ps1."
        }
        return $latest[0].FullName
    }

    $candidate = if ([System.IO.Path]::IsPathRooted($TaskValue)) {
        $TaskValue
    } else {
        Join-Path $Root $TaskValue
    }

    if ([System.Management.Automation.WildcardPattern]::ContainsWildcardCharacters($candidate)) {
        $matches = @(Get-ChildItem -Path $candidate -File -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending)
        if ($matches.Count -eq 0) {
            throw "No handoff matched: $TaskValue"
        }
        if ($matches.Count -gt 1) {
            Write-Warning "Multiple handoffs matched. Using newest: $($matches[0].FullName)"
        }
        return $matches[0].FullName
    }

    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    throw "Handoff not found: $TaskValue"
}

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Test-CommandFlag {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$Flag
    )

    try {
        $help = & $Command --help 2>&1 | Out-String
        return $help.Contains($Flag)
    } catch {
        Write-Warning "Could not inspect '$Command --help'. Not passing optional flag $Flag."
        return $false
    }
}

function Get-ClaudeBaseUrl {
    if (-not [string]::IsNullOrWhiteSpace($env:ANTHROPIC_BASE_URL)) {
        return $env:ANTHROPIC_BASE_URL
    }

    $settingsPath = Join-Path $HOME ".claude\settings.json"
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
        return $null
    }

    try {
        $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        if ($settings.env -and $settings.env.ANTHROPIC_BASE_URL) {
            return [string]$settings.env.ANTHROPIC_BASE_URL
        }
    } catch {
        Write-Warning "Could not parse Claude settings: $settingsPath"
    }

    return $null
}

function Assert-ClaudeGatewayReady {
    param(
        [string]$BaseUrl,
        [switch]$RequireModels
    )

    if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
        return
    }

    if ($BaseUrl -notmatch '^https?://(127\.0\.0\.1|localhost)(:\d+)?') {
        return
    }

    $modelsUrl = $BaseUrl.TrimEnd("/") + "/v1/models"
    try {
        $response = Invoke-WebRequest -Uri $modelsUrl -UseBasicParsing -TimeoutSec 8
        $json = $response.Content | ConvertFrom-Json
        $count = 0
        if ($json.models) {
            $count = @($json.models).Count
        } elseif ($json.data) {
            $count = @($json.data).Count
        }

        if ($count -eq 0) {
            $message = "Claude gateway at $BaseUrl reports zero models. Some CC Switch versions hide the model list even when routing works."
            if ($RequireModels) {
                throw "$message Remove -RequireGatewayModels or configure CC Switch so /v1/models is populated."
            }
            Write-Warning "$message Continuing because -RequireGatewayModels was not set."
        }
    } catch {
        if ($_.Exception.Message -like "*Remove -RequireGatewayModels*") {
            throw
        }
        Write-Warning "Could not preflight Claude gateway models at $modelsUrl. Continuing anyway. Details: $($_.Exception.Message)"
    }
}

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$outboxDir = Join-Path $pmDir "outbox"
$runningDir = Join-Path $pmDir "running"
$reportsDir = Join-Path $pmDir "reports"
$logsDir = Join-Path $pmDir "logs"
$archiveDir = Join-Path $pmDir "archive"

foreach ($dir in @($outboxDir, $runningDir, $reportsDir, $logsDir, $archiveDir)) {
    Ensure-Dir -Path $dir
}

$taskPath = Resolve-TaskFile -TaskValue $Task -Root $root -OutboxDir $outboxDir
$taskName = [System.IO.Path]::GetFileNameWithoutExtension($taskPath)
$taskRel = ConvertTo-RepoRelative -Path $taskPath -Root $root
$reportPath = Join-Path $reportsDir "$taskName.md"
$logPath = Join-Path $logsDir "$taskName.jsonl"
$lockPath = Join-Path $runningDir "$taskName.lock.json"
$reportRel = ConvertTo-RepoRelative -Path $reportsDir -Root $root
$reportRel = Join-Path $reportRel "$taskName.md"
$logRel = ConvertTo-RepoRelative -Path $logsDir -Root $root
$logRel = Join-Path $logRel "$taskName.jsonl"
$lockRel = ConvertTo-RepoRelative -Path $runningDir -Root $root
$lockRel = Join-Path $lockRel "$taskName.lock.json"

if ((Test-Path -LiteralPath $lockPath -PathType Leaf) -and -not $Force) {
    throw "Task appears to be running: $lockPath. Use -Force only after checking the process."
}

$prompt = @"
You are the coding agent for the FundTrader repo. Codex is the PM and architect.

Your task file is:
$taskRel

Write your final report to:
$reportRel

Rules:
- Read the task file completely before changing files.
- Implement only the approved scope in the task file.
- Before editing, inspect and summarize:
  git log --oneline -5
  git rev-parse --short HEAD
  git status --short --untracked-files=all
- Preserve unrelated dirty worktree changes.
- Do not commit, push, deploy, run destructive git commands, or use git add .
- Do not modify docs/pm/outbox, docs/pm/running, or docs/pm/logs.
- Only write docs/pm/reports/$taskName.md as your report artifact.
- Do not output hidden chain-of-thought or <think> blocks.
- If a product, architecture, data-contract, or deployment decision is missing, stop and write the question into the report.
- If the repo state is too different from the task assumptions, stop and write the mismatch into the report.
- Work in one bounded implementation pass. If the task grows too large, stop and report a follow-up plan.

After implementation and validation, write a concise Markdown report with:
1. Summary
2. Files changed
3. Validation commands and results
4. Open risks or PM decisions needed
"@

$claude = Get-Command $ClaudeCommand -ErrorAction SilentlyContinue
if (-not $claude -and -not $DryRun) {
    throw "Claude command not found: $ClaudeCommand. Install Claude Code or configure cc-switch so this command is available."
}

if (-not $DryRun -and -not $SkipGatewayPreflight) {
    Assert-ClaudeGatewayReady -BaseUrl (Get-ClaudeBaseUrl) -RequireModels:$RequireGatewayModels
}

$claudeArgs = @(
    "-p",
    "--permission-mode", $PermissionMode,
    "--output-format", "stream-json",
    "--verbose"
)

if (-not [string]::IsNullOrWhiteSpace($Model)) {
    $claudeArgs += @("--model", $Model)
}

if ($MaxTurns -gt 0) {
    if ($claude -and (Test-CommandFlag -Command $ClaudeCommand -Flag "--max-turns")) {
        $claudeArgs += @("--max-turns", "$MaxTurns")
    } else {
        Write-Warning "--max-turns is not supported by this Claude command. Continuing without it."
    }
}

$claudeArgs += $prompt

if ($DryRun) {
    Write-Host "Dry run. Claude was not started."
    Write-Host "Repo: $root"
    Write-Host "Task: $taskRel"
    Write-Host "Report: $reportRel"
    Write-Host "Log: $logRel"
    Write-Host "Lock: $lockRel"
    if (-not [string]::IsNullOrWhiteSpace($Model)) {
        Write-Host "Model: $Model"
    }
    $shownArgs = $claudeArgs[0..($claudeArgs.Count - 2)] -join " "
    Write-Host "Command: $ClaudeCommand $shownArgs <prompt>"
    exit 0
}

$lock = [ordered]@{
    task = $taskRel
    report = $reportRel
    log = $logRel
    startedAt = (Get-Date).ToString("o")
    pid = $PID
    claudeCommand = $ClaudeCommand
    model = if (-not [string]::IsNullOrWhiteSpace($Model)) { $Model } else { $null }
    permissionMode = $PermissionMode
    maxTurns = if ($MaxTurns -gt 0) { $MaxTurns } else { $null }
}
Write-Utf8NoBom -Path $lockPath -Content ($lock | ConvertTo-Json -Depth 4)

$exitCode = 0
Push-Location $root
try {
    Write-Host "Dispatching $taskRel to $ClaudeCommand..."
    & $ClaudeCommand @claudeArgs 2>&1 | Tee-Object -FilePath $logPath
    if ($null -ne $LASTEXITCODE) {
        $exitCode = $LASTEXITCODE
    }
} finally {
    Pop-Location
    if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
        Remove-Item -LiteralPath $lockPath -Force
    }
}

if ($exitCode -eq 0) {
    Write-Host "Dispatch finished. Log: $logPath"
    if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
        Write-Host "Report: $reportPath"
    } else {
        Write-Warning "Claude exited successfully but report was not found: $reportPath"
    }

    if ($ArchiveOnSuccess) {
        $archivePath = Join-Path $archiveDir ([System.IO.Path]::GetFileName($taskPath))
        Move-Item -LiteralPath $taskPath -Destination $archivePath -Force
        Write-Host "Archived handoff: $archivePath"
    }
} else {
    Write-Warning "Claude exited with code $exitCode. Log: $logPath"
}

exit $exitCode
