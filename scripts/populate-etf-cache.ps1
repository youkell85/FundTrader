# populate-etf-cache.ps1
# Dry-run-first ETFPriceCache population helper for P1-1 long-window calibration.

[CmdletBinding()]
param(
    [string]$StartDate = "",
    [string]$EndDate = "",
    [string[]]$Codes = @(),
    [switch]$Apply,
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
from datetime import date, timedelta

from app.allocation.data.long_window_producer import REPRESENTATIVE_ETFS
from app.storage.database import ETFPriceCache


def _window(start_arg: str, end_arg: str) -> tuple[str, str]:
    end = date.fromisoformat(end_arg) if end_arg else date.today()
    start = date.fromisoformat(start_arg) if start_arg else end - timedelta(days=int(3 * 365.25))
    return start.isoformat(), end.isoformat()


def _selected_codes(codes_arg: list[str]) -> dict[str, str]:
    all_codes = {asset: code for asset, code in REPRESENTATIVE_ETFS.items() if code}
    if not codes_arg:
        return all_codes
    wanted = {item.strip() for item in codes_arg if item and item.strip()}
    return {asset: code for asset, code in all_codes.items() if code in wanted or asset in wanted}


def _count_rows(selected: dict[str, str], start: str, end: str) -> list[dict]:
    rows = []
    for asset, code in selected.items():
        window_rows = ETFPriceCache.get_range(code, start, end)
        total_rows = ETFPriceCache.get_range(code, "1900-01-01", "2999-12-31")
        window_dates = sorted(window_rows)
        total_dates = sorted(total_rows)
        rows.append(
            {
                "asset": asset,
                "code": code,
                "window_rows": len(window_rows),
                "window_min_date": window_dates[0] if window_dates else None,
                "window_max_date": window_dates[-1] if window_dates else None,
                "total_rows": len(total_rows),
                "total_min_date": total_dates[0] if total_dates else None,
                "total_max_date": total_dates[-1] if total_dates else None,
            }
        )
    return rows


def _apply_population(selected: dict[str, str], start: str, end: str) -> dict:
    # Import live-fetch code only in apply mode. Dry-run remains provider-free.
    # Always use load_etf_history (the approved interface) — it fetches all
    # representative ETFs and writes through ETFPriceCache internally.
    from app.allocation.backtest.historical_data import load_etf_history

    prices_df, quality = load_etf_history(start, end, allow_network=True)
    return {
        "method": "load_etf_history",
        "columns": list(prices_df.columns),
        "quality": quality,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--codes", nargs="*", default=[])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    start, end = _window(args.start_date, args.end_date)
    selected = _selected_codes(args.codes)
    before = _count_rows(selected, start, end)
    apply_result = None
    if args.apply:
        apply_result = _apply_population(selected, start, end)
    after = _count_rows(selected, start, end)
    rows_added = sum(item["window_rows"] for item in after) - sum(item["window_rows"] for item in before)

    summary = {
        "status": "complete",
        "mode": "apply" if args.apply else "dry_run",
        "wrote_cache": bool(args.apply),
        "start_date": start,
        "end_date": end,
        "selected_count": len(selected),
        "rows_added": rows_added,
        "before": before,
        "after": after,
        "apply_result": apply_result,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print("ETF_CACHE_POPULATION_" + ("APPLY" if args.apply else "DRY_RUN"))
        for key in ("mode", "wrote_cache", "start_date", "end_date", "selected_count", "rows_added"):
            print(f"{key}={summary[key]}")
        for item in after:
            print(
                "{asset} code={code} window_rows={window_rows} window={window_min_date}..{window_max_date} "
                "total_rows={total_rows} total={total_min_date}..{total_max_date}".format(**item)
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
'@

    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("fundtrader-populate-etf-cache-{0}.py" -f ([System.Guid]::NewGuid().ToString("N")))
    [System.IO.File]::WriteAllText($tempScript, $py, [System.Text.UTF8Encoding]::new($false))

    $argsList = @($tempScript)
    if (-not [string]::IsNullOrWhiteSpace($StartDate)) {
        $argsList += @("--start-date", $StartDate)
    }
    if (-not [string]::IsNullOrWhiteSpace($EndDate)) {
        $argsList += @("--end-date", $EndDate)
    }
    if ($Codes.Count -gt 0) {
        $argsList += "--codes"
        $argsList += $Codes
    }
    if ($Apply) {
        $argsList += "--apply"
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