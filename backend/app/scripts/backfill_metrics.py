"""Batch backfill fund metrics (sharpe, max_drawdown, volatility, annualized_return)
from fund_nav_history into fund_metrics_snapshot.

Usage:
    cd backend && python app/scripts/backfill_metrics.py [--limit N] [--batch-size N] [--force]
"""

import logging

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

PROGRESS_FILE = Path(__file__).resolve().parent / ".backfill_metrics_progress.json"


def _load_progress():
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
        logging.exception("Ignored non-fatal exception")
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


def _calc_metrics_from_nav(nav_rows: list) -> dict:
    """浠庡噣鍊煎簭鍒楄绠楁寚鏍囷細sharpe_ratio, max_drawdown, volatility, annualized_return.

    nav_rows: [{nav_date, nav, accum_nav, day_growth}, ...] ordered ASC
    """
    points = []
    for r in nav_rows:
        nav = r.get("accum_nav") or r.get("nav")
        if nav is not None and nav > 0:
            points.append(float(nav))

    if len(points) < 2:
        return {}

    # daily returns
    daily_returns = []
    peak = points[0]
    max_drawdown = 0.0
    for i, nav in enumerate(points):
        if i > 0 and points[i - 1] > 0:
            daily_returns.append((nav - points[i - 1]) / points[i - 1])
        peak = max(peak, nav)
        if peak > 0:
            max_drawdown = min(max_drawdown, (nav - peak) / peak * 100)

    sharpe_ratio = None
    volatility = None
    annualized_return = None

    if len(daily_returns) > 1:
        mean = sum(daily_returns) / len(daily_returns)
        variance = sum((item - mean) ** 2 for item in daily_returns) / (len(daily_returns) - 1)
        vol = math.sqrt(variance) * math.sqrt(252)
        if vol > 0:
            sharpe_ratio = round((mean * 252) / vol, 2)
            volatility = round(vol * 100, 2)  # percent

    # annualized return from first to last point
    first_nav = points[0]
    last_nav = points[-1]
    days = len(points)
    if first_nav > 0 and days > 1:
        total_return = (last_nav - first_nav) / first_nav
        annualized_return = round((math.pow(1 + total_return, 252 / days) - 1) * 100, 2)

    return {
        "sharpe_ratio": sharpe_ratio,
        "max_drawdown": round(max_drawdown, 2) if max_drawdown != 0 else None,
        "volatility": volatility,
        "annualized_return": annualized_return,
        "nav_points": len(points),
    }


def get_target_codes(limit=0, force=False):
    """鑾峰彇闇€瑕佸洖濉殑鍩洪噾浠ｇ爜鍒楄〃銆?
    - force=True: 鍏ㄩ儴閲嶆柊璁＄畻
    - force=False: 鍙洖濉?fund_metrics_snapshot 涓病鏈夌殑
    """
    with get_db() as conn:
        if force:
            c = conn.execute("SELECT code FROM fund_master WHERE is_active = 1 ORDER BY code")
        else:
            c = conn.execute("""
                SELECT m.code FROM fund_master m
                LEFT JOIN fund_metrics_snapshot ms ON m.code = ms.code
                WHERE m.is_active = 1 AND ms.code IS NULL
                ORDER BY m.code
            """)
        codes = [r["code"] for r in c.fetchall()]
    if limit > 0:
        codes = codes[:limit]
    return codes


def backfill_metrics(limit=0, batch_size=100, force=False):
    progress = _load_progress()
    completed = set(progress.get("completed", []))
    failed = set(progress.get("failed", []))
    total_rows = progress.get("total_rows", 0)

    codes = get_target_codes(limit, force)
    if not force:
        codes = [c for c in codes if c not in completed]

    if not codes:
        print("All funds already have metrics. Skip.")
        return {"total": 0, "success": 0, "failed": 0, "rows": total_rows}

    total = len(codes)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Start metrics backfill")
    print(f"  Target: {total} funds (skipped {len(completed)})")
    print(f"  Batch size: {batch_size}")

    success = 0
    new_failed = 0
    start_time = time.time()

    for i, code in enumerate(codes):
        try:
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT nav_date, nav, accum_nav, day_growth FROM fund_nav_history "
                    "WHERE code = ? ORDER BY nav_date ASC",
                    (code,),
                ).fetchall()

            if not rows:
                failed.add(code)
                new_failed += 1
                continue

            nav_rows = [
                {"nav_date": r["nav_date"], "nav": r["nav"],
                 "accum_nav": r["accum_nav"], "day_growth": r["day_growth"]}
                for r in rows
            ]

            metrics = _calc_metrics_from_nav(nav_rows)
            if not metrics:
                failed.add(code)
                new_failed += 1
                continue

            metrics["code"] = code
            FundDataStore.save_metrics_batch([metrics], source="backfill")

            total_rows += 1
            completed.add(code)
            success += 1

        except Exception as e:
            console_error(f"Metrics error for {code}: {e}")
            failed.add(code)
            new_failed += 1

        # Save progress every batch_size
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
    parser = argparse.ArgumentParser(description="Batch backfill metrics via fund_nav_history")
    parser.add_argument("--limit", type=int, default=0, help="Max funds (0=all)")
    parser.add_argument("--batch-size", type=int, default=100, help="Commit batch size")
    parser.add_argument("--force", action="store_true", help="Force recompute all funds")
    args = parser.parse_args()

    result = backfill_metrics(limit=args.limit, batch_size=args.batch_size, force=args.force)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

