[CmdletBinding()]
param(
    [string]$Title = "Untitled task",
    [string]$TaskId,
    [switch]$Force,
    [switch]$Preview
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

function Sanitize-Name {
    param([Parameter(Mandatory = $true)][string]$Name)
    $safe = $Name -replace '[^A-Za-z0-9._-]', '-'
    $safe = $safe.Trim("-._")
    if ([string]::IsNullOrWhiteSpace($safe)) {
        throw "TaskId becomes empty after sanitizing."
    }
    return $safe
}

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"
$templateDir = Join-Path $pmDir "templates"
$outboxDir = Join-Path $pmDir "outbox"
$runningDir = Join-Path $pmDir "running"
$reportsDir = Join-Path $pmDir "reports"
$logsDir = Join-Path $pmDir "logs"
$archiveDir = Join-Path $pmDir "archive"

foreach ($dir in @($pmDir, $templateDir, $outboxDir, $runningDir, $reportsDir, $logsDir, $archiveDir)) {
    Ensure-Dir -Path $dir
}

if ([string]::IsNullOrWhiteSpace($TaskId)) {
    $TaskId = "TASK-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss")
}

$safeTaskId = Sanitize-Name -Name $TaskId
$templatePath = Join-Path $templateDir "HANDOFF.template.md"
if (-not (Test-Path -LiteralPath $templatePath -PathType Leaf)) {
    throw "Template not found: $templatePath"
}

$taskPath = Join-Path $outboxDir "$safeTaskId.md"
if ((Test-Path -LiteralPath $taskPath -PathType Leaf) -and -not $Force) {
    throw "Task already exists: $taskPath. Use -Force to overwrite."
}

$createdAt = (Get-Date).ToString("yyyy-MM-ddTHH:mm:sszzz")
$content = [System.IO.File]::ReadAllText($templatePath)
$content = $content.Replace("{{TASK_ID}}", $safeTaskId)
$content = $content.Replace("{{TITLE}}", $Title)
$content = $content.Replace("{{CREATED_AT}}", $createdAt)

if ($Preview) {
    Write-Host "Preview only. No file was written."
    Write-Host "Target: $taskPath"
    Write-Host ""
    Write-Output $content
    exit 0
}

Write-Utf8NoBom -Path $taskPath -Content $content

Write-Host "Created handoff: $taskPath"
Write-Host "Next:"
Write-Host "  1. Fill in the TBD sections."
Write-Host "  2. Dispatch with: .\scripts\pm-dispatch.ps1 -Task docs\pm\outbox\$safeTaskId.md"

