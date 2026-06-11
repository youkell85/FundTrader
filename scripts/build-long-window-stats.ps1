# build-long-window-stats.ps1
# Manual P4 long-window stats producer trigger.
# Default mode is dry-run. Use -Persist to save StatsSnapshotCache("long_window_stats").

[CmdletBinding()]
param(
    [string]$AsOfDate = "",
    [int]$Years = 3,
    [switch]$Persist,
    [switch]$Json
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
    return (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
}

$repoRoot = Get-RepoRoot
$backendRoot = Join-Path $repoRoot "backend"
$oldPythonPath = $env:PYTHONPATH

try {
    if ([string]::IsNullOrWhiteSpace($oldPythonPath)) {
        $env:PYTHONPATH = $backendRoot
    } else {
        $env:PYTHONPATH = "$backendRoot;$oldPythonPath"
    }

    $py = @'
import argparse
import json
import sys

from app.allocation.data.long_window_producer import (
    build_long_window_stats,
    persist_long_window_stats,
)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of-date", default="")
    parser.add_argument("--years", type=int, default=3)
    parser.add_argument("--persist", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    snapshot = build_long_window_stats(
        as_of_date=args.as_of_date or None,
        years=args.years,
    )
    if snapshot is None:
        message = {
            "status": "unavailable",
            "reason": "insufficient_long_window_cache_coverage",
            "persisted": False,
        }
        print(json.dumps(message, ensure_ascii=False) if args.json else "LONG_WINDOW_STATS_UNAVAILABLE insufficient_long_window_cache_coverage")
        return 2

    if args.persist:
        persist_long_window_stats(snapshot)

    quality = snapshot.get("quality") or {}
    available = [asset for asset, item in quality.items() if item.get("status") == "available"]
    synthesized = [asset for asset, item in quality.items() if item.get("status") == "synthesized"]
    missing = {
        asset: item.get("reason") or item.get("status")
        for asset, item in quality.items()
        if item.get("status") not in {"available", "synthesized"}
    }
    summary = {
        "status": "ok",
        "persisted": bool(args.persist),
        "coverage": snapshot.get("coverage"),
        "confidence_score": snapshot.get("confidence_score"),
        "window_start": snapshot.get("window_start"),
        "window_end": snapshot.get("window_end"),
        "n_observations": snapshot.get("n_observations"),
        "available_count": len(available),
        "synthesized_count": len(synthesized),
        "missing": missing,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print("LONG_WINDOW_STATS_OK")
        for key in (
            "persisted",
            "coverage",
            "confidence_score",
            "window_start",
            "window_end",
            "n_observations",
            "available_count",
            "synthesized_count",
        ):
            print(f"{key}={summary.get(key)}")
        if missing:
            print("missing=" + json.dumps(missing, ensure_ascii=False, sort_keys=True))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'@

    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("fundtrader-long-window-{0}.py" -f ([System.Guid]::NewGuid().ToString("N")))
    [System.IO.File]::WriteAllText($tempScript, $py, [System.Text.UTF8Encoding]::new($false))

    $argsList = @($tempScript, "--years", "$Years")
    if (-not [string]::IsNullOrWhiteSpace($AsOfDate)) {
        $argsList += @("--as-of-date", $AsOfDate)
    }
    if ($Persist) {
        $argsList += "--persist"
    }
    if ($Json) {
        $argsList += "--json"
    }

    Push-Location -LiteralPath $backendRoot
    try {
        & python @argsList
        exit $LASTEXITCODE
    } finally {
        Pop-Location
        if (Test-Path -LiteralPath $tempScript -PathType Leaf) {
            Remove-Item -LiteralPath $tempScript -Force
        }
    }
} finally {
    $env:PYTHONPATH = $oldPythonPath
}
