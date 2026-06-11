# check-etf-cache-coverage.ps1
# Read-only P4 ETF price cache coverage audit for long-window stats.

[CmdletBinding()]
param(
    [string]$AsOfDate = "",
    [int]$Years = 3,
    [int]$MinObservations = 252,
    [switch]$AllowInsufficient,
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
from datetime import date, datetime, timedelta

from app.allocation.config import ASSET_CLASSES
from app.allocation.data.long_window_producer import MIN_COVERAGE, REPRESENTATIVE_ETFS
from app.storage.database import get_db


def _parse_date(value: str | None) -> date:
    if value:
        return datetime.strptime(value, "%Y-%m-%d").date()
    return date.today()


def _row_for(conn, code: str, start: str, end: str) -> dict:
    total = conn.execute(
        """
        SELECT COUNT(*) AS c, MIN(trade_date) AS min_date, MAX(trade_date) AS max_date
        FROM etf_daily_prices
        WHERE code = ?
        """,
        (code,),
    ).fetchone()
    window = conn.execute(
        """
        SELECT COUNT(*) AS c, MIN(trade_date) AS min_date, MAX(trade_date) AS max_date
        FROM etf_daily_prices
        WHERE code = ? AND trade_date >= ? AND trade_date <= ?
        """,
        (code, start, end),
    ).fetchone()
    return {
        "total_rows": int(total["c"] or 0),
        "total_min_date": total["min_date"],
        "total_max_date": total["max_date"],
        "window_rows": int(window["c"] or 0),
        "window_min_date": window["min_date"],
        "window_max_date": window["max_date"],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--as-of-date", default="")
    parser.add_argument("--years", type=int, default=3)
    parser.add_argument("--min-observations", type=int, default=252)
    parser.add_argument("--allow-insufficient", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    end = _parse_date(args.as_of_date or None)
    start = end - timedelta(days=int(max(args.years, 1) * 365.25))
    start_s = start.isoformat()
    end_s = end.isoformat()
    min_observations = max(args.min_observations, 1)

    assets = []
    available = []
    synthesized = []
    missing = []

    with get_db() as conn:
        for asset in ASSET_CLASSES:
            code = REPRESENTATIVE_ETFS.get(asset)
            if code is None:
                item = {
                    "asset": asset,
                    "code": None,
                    "status": "synthesized",
                    "reason": "no_representative_etf",
                }
                synthesized.append(asset)
                assets.append(item)
                continue

            counts = _row_for(conn, code, start_s, end_s)
            status = "available" if counts["window_rows"] >= min_observations else "missing"
            item = {
                "asset": asset,
                "code": code,
                "status": status,
                "reason": None if status == "available" else f"insufficient_cache_data:{counts['window_rows']}",
                **counts,
            }
            if status == "available":
                available.append(asset)
            else:
                missing.append(asset)
            assets.append(item)

    # long_window_producer synthesizes money_fund if its ETF cache is missing.
    effective_available = set(available) | set(synthesized)
    if "money_fund" in missing:
        effective_available.add("money_fund")

    coverage = round(len(effective_available) / len(ASSET_CLASSES), 4)
    status = "ok" if coverage >= MIN_COVERAGE else "insufficient"
    summary = {
        "status": status,
        "window_start": start_s,
        "window_end": end_s,
        "years": max(args.years, 1),
        "min_observations": min_observations,
        "coverage": coverage,
        "min_coverage": MIN_COVERAGE,
        "available_count": len(available),
        "synthesized_count": len(synthesized) + (1 if "money_fund" in missing else 0),
        "missing_count": len(ASSET_CLASSES) - len(effective_available),
        "assets": assets,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
    else:
        print(f"ETF_CACHE_COVERAGE_{status.upper()}")
        for key in (
            "window_start",
            "window_end",
            "years",
            "min_observations",
            "coverage",
            "min_coverage",
            "available_count",
            "synthesized_count",
            "missing_count",
        ):
            print(f"{key}={summary[key]}")
        for item in assets:
            print(
                "{asset} code={code} status={status} window_rows={window_rows} "
                "window={window_min_date}..{window_max_date} total_rows={total_rows} "
                "total={total_min_date}..{total_max_date} reason={reason}".format(
                    window_rows=item.get("window_rows", 0),
                    window_min_date=item.get("window_min_date"),
                    window_max_date=item.get("window_max_date"),
                    total_rows=item.get("total_rows", 0),
                    total_min_date=item.get("total_min_date"),
                    total_max_date=item.get("total_max_date"),
                    **item,
                )
            )

    if status == "ok" or args.allow_insufficient:
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
'@

    $tempScript = Join-Path ([System.IO.Path]::GetTempPath()) ("fundtrader-etf-cache-coverage-{0}.py" -f ([System.Guid]::NewGuid().ToString("N")))
    [System.IO.File]::WriteAllText($tempScript, $py, [System.Text.UTF8Encoding]::new($false))

    $argsList = @($tempScript, "--years", "$Years", "--min-observations", "$MinObservations")
    if (-not [string]::IsNullOrWhiteSpace($AsOfDate)) {
        $argsList += @("--as-of-date", $AsOfDate)
    }
    if ($AllowInsufficient) {
        $argsList += "--allow-insufficient"
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
