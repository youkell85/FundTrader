[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Task,

    [switch]$Run,

    [int]$Block = 0,

    [string]$ReviewDir,

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

function Write-Utf8NoBom {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Content
    )
    $encoding = [System.Text.UTF8Encoding]::new($false)
    [System.IO.File]::WriteAllText($Path, $Content, $encoding)
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

# Unsafe command patterns
$unsafePatterns = @(
    "pm-dispatch.ps1",
    "git add",
    "git commit",
    "git push",
    "git reset",
    "git checkout",
    "Remove-Item",
    "Move-Item",
    "rm ",
    "del ",
    "deploy",
    "systemctl",
    "ssh",
    "scp",
    "sftp",
    "curl -X POST"
)

function Test-IsSafe {
    param([Parameter(Mandatory = $true)][string]$CommandText)

    # Check unsafe patterns
    foreach ($pattern in $unsafePatterns) {
        if ($CommandText -match [regex]::Escape($pattern)) {
            return @{ safe = $false; reason = "Contains unsafe pattern: $pattern" }
        }
    }

    # npx vite build without --outDir
    if ($CommandText -match '\bnpx\s+vite\s+build\b' -and $CommandText -notmatch '--outDir') {
        return @{ safe = $false; reason = "npx vite build without --outDir" }
    }

    # pm-loop.ps1 without -DryRun
    if ($CommandText -match '\bpm-loop\.ps1\b' -and $CommandText -notmatch '-DryRun') {
        return @{ safe = $false; reason = "pm-loop.ps1 without -DryRun" }
    }

    # pm-review.ps1 without -Task
    if ($CommandText -match '\bpm-review\.ps1\b' -and $CommandText -notmatch '-Task\s') {
        return @{ safe = $false; reason = "pm-review.ps1 without -Task argument" }
    }

    return @{ safe = $true; reason = "Passed safety checks" }
}

function Extract-ValidationBlocks {
    param([Parameter(Mandatory = $true)][string]$Content)

    $blocks = [System.Collections.Generic.List[object]]::new()
    $lines = $content -split "`r?`n"

    $inValidation = $false
    $inFence = $false
    $fenceLang = ""
    $fenceLines = [System.Collections.Generic.List[string]]::new()
    $blockNum = 0

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]

        # Track section headers
        if ($line -match '^##\s+Validation') {
            $inValidation = $true
            continue
        }
        if ($inValidation -and $line -match '^##\s') {
            $inValidation = $false
            continue
        }

        if (-not $inValidation) { continue }

        # Fence detection
        if ($line -match '^```(\w*)\s*$') {
            if (-not $inFence) {
                $inFence = $true
                $fenceLang = $Matches[1]
                $fenceLines = [System.Collections.Generic.List[string]]::new()
            } else {
                # End of fence
                $inFence = $false
                $blockNum++

                $lang = $fenceLang.Trim()
                $supported = ($lang -eq "" -or $lang -eq "powershell" -or $lang -eq "ps1" -or $lang -eq "shell" -or $lang -eq "bash" -or $lang -eq "text")

                if (-not $supported) {
                    $blocks.Add([ordered]@{
                        number = $blockNum
                        language = $lang
                        classification = "unsupported"
                        reason = "Unsupported language: $lang"
                        command = ($fenceLines -join "`n")
                        exitCode = $null
                        stdout = $null
                        stderr = $null
                    })
                    continue
                }

                $cmdText = ($fenceLines -join "`n").Trim()
                if ([string]::IsNullOrWhiteSpace($cmdText)) {
                    $blocks.Add([ordered]@{
                        number = $blockNum
                        language = $lang
                        classification = "skipped_unsafe"
                        reason = "Empty block"
                        command = ""
                        exitCode = $null
                        stdout = $null
                        stderr = $null
                    })
                    continue
                }

                $safety = Test-IsSafe -CommandText $cmdText
                $classification = if ($safety.safe) { "safe" } else { "skipped_unsafe" }

                $blocks.Add([ordered]@{
                    number = $blockNum
                    language = $lang
                    classification = $classification
                    reason = $safety.reason
                    command = $cmdText
                    exitCode = $null
                    stdout = $null
                    stderr = $null
                })
            }
        } elseif ($inFence) {
            $fenceLines.Add($line)
        }
    }

    return $blocks.ToArray()
}

# --- Main ---

$root = Get-RepoRoot
$pmDir = Join-Path $root "docs\pm"

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
    $errMsg = "Task file not found: $taskPath"
    if ($AsJson) {
        Write-Host ('{"error":"' + $errMsg + '","exitCode":3}') -NoNewline
    } else {
        Write-Host $errMsg
    }
    exit 3
}

$taskPath = (Resolve-Path -LiteralPath $taskPath).Path
$taskId = [System.IO.Path]::GetFileNameWithoutExtension($taskPath)
$taskRel = ConvertTo-RepoRelative -Path $taskPath -Root $root

# Read task content
$taskContent = Get-Content -LiteralPath $taskPath -Raw -ErrorAction SilentlyContinue
if (-not $taskContent) {
    $errMsg = "Could not read task file: $taskPath"
    if ($AsJson) {
        Write-Host ('{"error":"' + $errMsg + '","exitCode":3}') -NoNewline
    } else {
        Write-Host $errMsg
    }
    exit 3
}

# Extract validation blocks
$blocks = Extract-ValidationBlocks -Content $taskContent

if ($blocks.Count -eq 0) {
    $errMsg = "No validation blocks found in task: $taskRel"
    if ($AsJson) {
        Write-Host ('{"error":"' + $errMsg + '","exitCode":3}') -NoNewline
    } else {
        Write-Host $errMsg
    }
    exit 3
}

# Filter by block number if specified
if ($Block -gt 0) {
    $blocks = @($blocks | Where-Object { $_.number -eq $Block })
    if ($blocks.Count -eq 0) {
        $errMsg = "Block $Block not found in task: $taskRel"
        if ($AsJson) {
            Write-Host ('{"error":"' + $errMsg + '","exitCode":3}') -NoNewline
        } else {
            Write-Host $errMsg
        }
        exit 3
    }
}

# Execute safe blocks if -Run
$anyFailed = $false
if ($Run) {
    foreach ($validationBlock in $blocks) {
        if ($validationBlock.classification -ne "safe") {
            continue
        }

        $cmd = $validationBlock.command
        $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) "pm-accept-$taskId-block$($validationBlock.number).ps1"
        try {
            Write-Utf8NoBom -Path $tempScript -Content $cmd

            # Native tools often write advisory warnings to stderr while still
            # exiting successfully. Capture combined output but trust the
            # process exit code.
            $prevEAP = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                $stdout = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tempScript 2>&1
                $exitCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEAP
            }

            $validationBlock.exitCode = $exitCode
            $outputStr = ($stdout | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
            if ($outputStr.Length -gt 4000) {
                $outputStr = $outputStr.Substring(0, 4000) + "...[truncated]"
            }
            $validationBlock.stdout = $outputStr

            if ($exitCode -ne 0) {
                $anyFailed = $true
            }
        } catch {
            $validationBlock.exitCode = -1
            $validationBlock.stderr = $_.Exception.Message
            $anyFailed = $true
        } finally {
            if (Test-Path -LiteralPath $tempScript -PathType Leaf) {
                Remove-Item -LiteralPath $tempScript -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

# Determine exit code
$exitCode = 0
if ($Run -and $anyFailed) {
    $exitCode = 2
}

# Build summary
$mode = if ($Run) { "run" } else { "list" }
$safeCount = @($blocks | Where-Object { $_.classification -eq "safe" }).Count
$skippedCount = @($blocks | Where-Object { $_.classification -eq "skipped_unsafe" }).Count
$unsupportedCount = @($blocks | Where-Object { $_.classification -eq "unsupported" }).Count
$passedCount = if ($Run) { @($blocks | Where-Object { $_.classification -eq "safe" -and $_.exitCode -eq 0 }).Count } else { 0 }
$failedCount = if ($Run) { @($blocks | Where-Object { $_.classification -eq "safe" -and $_.exitCode -ne 0 }).Count } else { 0 }

$recommendedNext = if ($Run -and $anyFailed) {
    "One or more safe blocks failed. Review output and fix issues."
} elseif ($Run) {
    "All safe blocks passed. Review skipped blocks manually if needed."
} else {
    "Review listed blocks. Use -Run to execute safe blocks."
}

# Write acceptance JSON
$acceptJson = [ordered]@{
    taskId = $taskId
    mode = $mode
    generatedAt = (Get-Date).ToString("o")
    taskPath = $taskRel
    summary = [ordered]@{
        totalBlocks = $blocks.Count
        safe = $safeCount
        skipped_unsafe = $skippedCount
        unsupported = $unsupportedCount
        passed = $passedCount
        failed = $failedCount
    }
    recommendedNext = $recommendedNext
    blocks = $blocks
}

$jsonPath = Join-Path $reviewDir "$taskId.acceptance.json"
Write-Utf8NoBom -Path $jsonPath -Content ($acceptJson | ConvertTo-Json -Depth 5)

# Write acceptance Markdown
$mdLines = @()
$mdLines += "# Acceptance: $taskId"
$mdLines += ""
$mdLines += "**Mode:** $mode"
$mdLines += "**Generated:** $($acceptJson.generatedAt)"
$mdLines += ""
$mdLines += "## Summary"
$mdLines += ""
$mdLines += "| Metric | Count |"
$mdLines += "|--------|-------|"
$mdLines += "| Total blocks | $($blocks.Count) |"
$mdLines += "| Safe | $safeCount |"
$mdLines += "| Skipped (unsafe) | $skippedCount |"
$mdLines += "| Unsupported | $unsupportedCount |"
if ($Run) {
    $mdLines += "| Passed | $passedCount |"
    $mdLines += "| Failed | $failedCount |"
}
$mdLines += ""
$mdLines += "## Blocks"
$mdLines += ""

foreach ($validationBlock in $blocks) {
    $mdLines += "### Block $($validationBlock.number)"
    $mdLines += ""
    $mdLines += "- **Classification:** $($validationBlock.classification)"
    $mdLines += "- **Reason:** $($validationBlock.reason)"
    $mdLines += "- **Language:** $($validationBlock.language)"
    $mdLines += ""
    $mdLines += "``````$($validationBlock.language)"
    $mdLines += $validationBlock.command
    $mdLines += "``````"
    $mdLines += ""

    if ($Run -and $validationBlock.classification -eq "safe") {
        $mdLines += "- **Exit Code:** $($validationBlock.exitCode)"
        if ($validationBlock.stdout) {
            $mdLines += ""
            $mdLines += "``````"
            $mdLines += $validationBlock.stdout
            $mdLines += "``````"
        }
        if ($validationBlock.stderr) {
            $mdLines += ""
            $mdLines += "**Stderr:**"
            $mdLines += "``````"
            $mdLines += $validationBlock.stderr
            $mdLines += "``````"
        }
        $mdLines += ""
    }
}

$mdLines += "## Recommended Next Action"
$mdLines += ""
$mdLines += $recommendedNext

$mdPath = Join-Path $reviewDir "$taskId.acceptance.md"
Write-Utf8NoBom -Path $mdPath -Content ($mdLines -join "`n")

# Output
if ($AsJson) {
    $acceptJson | ConvertTo-Json -Depth 5
} else {
    Write-Host "Acceptance: $taskId"
    Write-Host "Mode: $mode"
    Write-Host "Blocks: $($blocks.Count) total, $safeCount safe, $skippedCount skipped, $unsupportedCount unsupported"
    if ($Run) {
        Write-Host "Results: $passedCount passed, $failedCount failed"
    }
    Write-Host ""
    Write-Host "Artifacts:"
    Write-Host "  $mdPath"
    Write-Host "  $jsonPath"
    Write-Host ""
    Write-Host "Recommended: $recommendedNext"
}

exit $exitCode
