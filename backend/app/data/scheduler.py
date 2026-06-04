"""Data refresh scheduler — orchestrates daily backfill tasks.

Usage (manual / cron):
    cd backend && python -m app.data.scheduler --all
    cd backend && python -m app.data.scheduler --task nav
    cd backend && python -m app.data.scheduler --task metrics --limit 100

Tasks:
    nav         → backfill_nav_tushare.py (incremental)
    quarterly   → backfill_quarterly_tushare.py
    metrics     → backfill_metrics.py (only missing)
    drawdown    → backfill_drawdown.py (only missing)
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.storage.database import FundDataStore, get_db
from app.utils import console_error

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"


def _run_script(name: str, args: list[str]) -> dict:
    """Execute a backfill script as a subprocess, return parsed JSON result."""
    import subprocess

    script_path = SCRIPTS_DIR / f"backfill_{name}.py"
    if not script_path.exists():
        return {"error": f"Script not found: {script_path}"}

    cmd = [sys.executable, str(script_path)] + args
    print(f"  [{datetime.now().strftime('%H:%M:%S')}] Running: {' '.join(cmd[-3:])}")
    start = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=3600, check=False
        )
        elapsed = time.time() - start
        # Try to parse JSON from last line of stdout
        lines = result.stdout.strip().splitlines()
        parsed = None
        for line in reversed(lines):
            try:
                parsed = json.loads(line)
                break
            except Exception:
                continue
        return {
            "script": name,
            "elapsed": round(elapsed, 1),
            "returncode": result.returncode,
            "result": parsed,
            "stdout_tail": lines[-5:] if lines else [],
            "stderr": result.stderr[-500:] if result.stderr else "",
        }
    except subprocess.TimeoutExpired:
        return {"script": name, "error": "timeout after 3600s"}
    except Exception as e:
        return {"script": name, "error": str(e)}


def run_nav_backfill(limit: int = 0, batch_size: int = 100) -> dict:
    return _run_script("nav_tushare", ["--incremental", "--batch-size", str(batch_size)])


def run_quarterly_backfill(limit: int = 0, batch_size: int = 50) -> dict:
    return _run_script("quarterly_tushare", ["--limit", str(limit), "--batch-size", str(batch_size)])


def run_metrics_backfill(limit: int = 0, batch_size: int = 100) -> dict:
    return _run_script("metrics", ["--limit", str(limit), "--batch-size", str(batch_size)])


def run_drawdown_backfill(limit: int = 0, batch_size: int = 50) -> dict:
    return _run_script("drawdown", ["--limit", str(limit), "--batch-size", str(batch_size)])


def check_data_health() -> dict:
    """Quick health check: count empty tables and stale data."""
    with get_db() as conn:
        metrics_empty = conn.execute(
            "SELECT COUNT(*) FROM fund_metrics_snapshot"
        ).fetchone()[0]
        drawdown_empty = conn.execute(
            "SELECT COUNT(*) FROM fund_drawdown_series"
        ).fetchone()[0]
        report_empty = conn.execute(
            "SELECT COUNT(*) FROM fund_report_snapshot"
        ).fetchone()[0]
        nav_total = conn.execute(
            "SELECT COUNT(*) FROM fund_nav_history"
        ).fetchone()[0]
        stale_nav = conn.execute(
            """SELECT COUNT(DISTINCT code) FROM fund_nav_history
               WHERE nav_date < date('now', '-2 days')"""
        ).fetchone()[0]
    return {
        "metrics_snapshot_rows": metrics_empty,
        "drawdown_series_rows": drawdown_empty,
        "report_snapshot_rows": report_empty,
        "nav_history_total": nav_total,
        "stale_nav_funds": stale_nav,
        "needs_metrics_backfill": metrics_empty == 0,
        "needs_drawdown_backfill": drawdown_empty == 0,
    }


def run_all(limit: int = 0) -> list[dict]:
    """Run all backfill tasks in order."""
    print(f"[{datetime.now().strftime('%H:%M:%S')}] === Data Refresh Scheduler ===")
    health = check_data_health()
    print(f"  Health: {json.dumps(health, ensure_ascii=False, indent=2)}")

    results = []

    # 1. NAV incremental
    print("\n[1/4] NAV backfill (incremental)")
    results.append(run_nav_backfill(limit=limit))

    # 2. Quarterly (weekly, but cheap to run)
    print("\n[2/4] Quarterly data backfill")
    results.append(run_quarterly_backfill(limit=limit))

    # 3. Metrics (fill missing)
    print("\n[3/4] Metrics backfill")
    results.append(run_metrics_backfill(limit=limit))

    # 4. Drawdown (fill missing)
    print("\n[4/4] Drawdown backfill")
    results.append(run_drawdown_backfill(limit=limit))

    # Summary
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] === Summary ===")
    for r in results:
        status = "OK" if r.get("returncode") == 0 else "FAIL"
        res = r.get("result") or {}
        print(
            f"  {r['script']:20s} {status}  "
            f"ok={res.get('success', 0)} fail={res.get('failed', 0)} "
            f"rows={res.get('rows', 0)} time={r.get('elapsed', 0)}s"
        )

    return results


def main():
    parser = argparse.ArgumentParser(description="FundTrader data refresh scheduler")
    parser.add_argument("--all", action="store_true", help="Run all backfill tasks")
    parser.add_argument("--task", choices=["nav", "quarterly", "metrics", "drawdown", "health"],
                        help="Run specific task")
    parser.add_argument("--limit", type=int, default=0, help="Max funds per task (0=all)")
    parser.add_argument("--batch-size", type=int, default=100, help="Batch size")
    args = parser.parse_args()

    if args.task == "health":
        print(json.dumps(check_data_health(), ensure_ascii=False, indent=2))
        return

    if args.task == "nav":
        result = run_nav_backfill(limit=args.limit, batch_size=args.batch_size)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.task == "quarterly":
        result = run_quarterly_backfill(limit=args.limit, batch_size=args.batch_size)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.task == "metrics":
        result = run_metrics_backfill(limit=args.limit, batch_size=args.batch_size)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.task == "drawdown":
        result = run_drawdown_backfill(limit=args.limit, batch_size=args.batch_size)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    if args.all:
        results = run_all(limit=args.limit)
        print(json.dumps(
            [{"script": r["script"], "result": r.get("result")} for r in results],
            ensure_ascii=False, indent=2,
        ))
        return

    parser.print_help()


if __name__ == "__main__":
    main()
