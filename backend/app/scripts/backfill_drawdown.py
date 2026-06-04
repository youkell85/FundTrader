"""Batch backfill fund drawdown series from fund_nav_history into fund_drawdown_series.

Usage:
    cd backend && python app/scripts/backfill_drawdown.py [--limit N] [--batch-size N] [--force]
"""
import argparse
import json
import math
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.storage.database import FundDataStore, get_db
from app.utils import console_error

PROGRESS_FILE = Path(__file__).resolve().parent / ".backfill_drawdown_progress.json"


def _load_progress():
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"completed": [], "failed": [], "total_rows": 0}


def _save_progress(completed, failed, total_rows):
    try:
        tmp = PROGRESS_FILE.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "completed": sorted(set(completed)),
                    "failed": sorted(set(failed)),
                    "total_rows": total_rows,
                    "updated_at": datetime.now().isoformat(),
                },
                f, ensure_ascii=False, indent=2,
            )
        os.replace(tmp, PROGRESS_FILE)
    except Exception as e:
        console_error(f"save progress failed: {e}")


def _calc_drawdown_series(nav_rows: list) -> list[dict]:
    """从净值序列计算回撤序列。

    nav_rows: [{nav_date, accum_nav}, ...] ordered ASC
    Returns: [{date, drawdown, peak_nav, current_nav}, ...]
    """
    points = []
    for r in nav_rows:
        nav = r.get("accum_nav") or r.get("nav")
        if nav is not None and nav > 0:
            points.append({
                "date": str(r.get("nav_date") or r.get("date") or "").strip(),
                "nav": float(nav),
            })

    if len(points) < 2:
        return []

    peak = points[0]["nav"]
    drawdown_records = []

    for p in points:
        nav = p["nav"]
        peak = max(peak, nav)
        if peak > 0:
            dd = (nav - peak) / peak * 100
            drawdown_records.append({
                "date": p["date"],
                "drawdown": round(dd, 4),
                "peak_nav": round(peak, 6),
                "current_nav": round(nav, 6),
            })

    return drawdown_records


def get_target_codes(limit=0, force=False):
    """获取需要回填回撤序列的基金代码。"""
    with get_db() as conn:
        if force:
            c = conn.execute("SELECT code FROM fund_master WHERE is_active = 1 ORDER BY code")
        else:
            c = conn.execute("""
                SELECT m.code FROM fund_master m
                LEFT JOIN (
                    SELECT DISTINCT code FROM fund_drawdown_series
                ) ds ON m.code = ds.code
                WHERE m.is_active = 1 AND ds.code IS NULL
                ORDER BY m.code
            """)
        codes = [r["code"] for r in c.fetchall()]
    if limit > 0:
        codes = codes[:limit]
    return codes


def backfill_drawdown(limit=0, batch_size=50, force=False):
    progress = _load_progress()
    completed = set(progress.get("completed", []))
    failed = set(progress.get("failed", []))
    total_rows = progress.get("total_rows", 0)

    codes = get_target_codes(limit, force)
    if not force:
        codes = [c for c in codes if c not in completed]

    if not codes:
        print("All funds already have drawdown series. Skip.")
        return {"total": 0, "success": 0, "failed": 0, "rows": total_rows}

    total = len(codes)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Start drawdown backfill")
    print(f"  Target: {total} funds (skipped {len(completed)})")
    print(f"  Batch size: {batch_size}")

    success = 0
    new_failed = 0
    start_time = time.time()

    for i, code in enumerate(codes):
        try:
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT nav_date, nav, accum_nav FROM fund_nav_history "
                    "WHERE code = ? ORDER BY nav_date ASC",
                    (code,),
                ).fetchall()

            if not rows:
                failed.add(code)
                new_failed += 1
                continue

            nav_rows = [
                {"nav_date": r["nav_date"], "nav": r["nav"], "accum_nav": r["accum_nav"]}
                for r in rows
            ]

            drawdowns = _calc_drawdown_series(nav_rows)
            if not drawdowns:
                failed.add(code)
                new_failed += 1
                continue

            FundDataStore.save_drawdown_series_batch(
                code, drawdowns, window_days=365, source="backfill"
            )

            total_rows += len(drawdowns)
            completed.add(code)
            success += 1

        except Exception as e:
            console_error(f"Drawdown error for {code}: {e}")
            failed.add(code)
            new_failed += 1

        if (i + 1) % batch_size == 0 or i + 1 == total:
            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed * 60 if elapsed > 0 else 0
            print(
                f"  [{i + 1}/{total}] OK {success}, FAIL {new_failed}, "
                f"rows {total_rows}, rate {rate:.1f} funds/min"
            )
            _save_progress(list(completed), list(failed), total_rows)

    elapsed = time.time() - start_time
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Done")
    print(f"  Total: {total}, OK: {success}, FAIL: {new_failed}")
    print(f"  Rows: {total_rows}, Time: {elapsed:.1f}s")

    return {"total": total, "success": success, "failed": new_failed, "rows": total_rows}


def main():
    parser = argparse.ArgumentParser(description="Batch backfill drawdown via fund_nav_history")
    parser.add_argument("--limit", type=int, default=0, help="Max funds (0=all)")
    parser.add_argument("--batch-size", type=int, default=50, help="Commit batch size")
    parser.add_argument("--force", action="store_true", help="Force recompute all funds")
    args = parser.parse_args()

    result = backfill_drawdown(limit=args.limit, batch_size=args.batch_size, force=args.force)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
