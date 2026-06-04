"""Batch backfill fund NAV history from Tushare to SQLite.

Usage:
    cd backend && python app/scripts/backfill_nav_tushare.py [--limit N] [--batch-size N]
"""
import argparse
import json
import os
import sqlite3
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from app.data.providers.tushare_provider import TushareProvider
from app.utils import console_error

DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "fundtrader.db"
PROGRESS_FILE = Path(__file__).resolve().parent / ".backfill_nav_tushare_progress.json"

# NOTE: Do NOT modify os.environ here. TushareProvider handles its own connection.
# Proxy config, if needed, should be set at the process level before running this script.


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
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "completed": sorted(set(completed)),
                    "failed": sorted(set(failed)),
                    "total_rows": total_rows,
                    "updated_at": datetime.now().isoformat(),
                },
                f, ensure_ascii=False, indent=2,
            )
    except Exception as e:
        console_error(f"save progress failed: {e}")


def get_target_codes(db: sqlite3.Connection, limit=0, min_gap_hours=24):
    """从已有连接读取目标代码，支持增量模式。

    Args:
        db: SQLite 连接
        limit: 最大返回数量 (0=全部)
        min_gap_hours: 只返回距离上次更新超过此时间的基金 (0=全部)
    """
    if min_gap_hours > 0:
        c = db.execute(
            """SELECT m.code FROM fund_master m
               LEFT JOIN (
                   SELECT code, MAX(nav_date) as last_date
                   FROM fund_nav_history GROUP BY code
               ) h ON m.code = h.code
               WHERE m.is_active = 1
                 AND (h.last_date IS NULL
                      OR julianday('now') - julianday(h.last_date) > ?)
               ORDER BY m.code""",
            (min_gap_hours / 24,),
        )
    else:
        c = db.execute("SELECT code FROM fund_master WHERE is_active = 1 ORDER BY code")
    codes = [r["code"] for r in c.fetchall()]
    if limit > 0:
        codes = codes[:limit]
    return codes


def backfill_nav_history(limit=0, batch_size=100, incremental=False):
    progress = _load_progress()
    completed = set(progress.get("completed", []))
    failed = set(progress.get("failed", []))
    total_rows = progress.get("total_rows", 0)

    # Single persistent DB connection for the entire run
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout = 30000")

    min_gap = 24 if incremental else 0
    codes = get_target_codes(db, limit, min_gap_hours=min_gap)
    if not incremental:
        codes = [c for c in codes if c not in completed]

    if not codes:
        print("All funds already have NAV data. Skip.")
        db.close()
        return {"total": 0, "success": 0, "failed": 0, "rows": total_rows}

    provider = TushareProvider()
    if not provider.is_available():
        print("Tushare not available. Check TUSHARE_TOKEN.")
        db.close()
        return {"total": 0, "success": 0, "failed": 0}

    total = len(codes)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Start NAV backfill via Tushare")
    print(f"  Target: {total} funds (skipped {len(completed)})")
    print(f"  Batch size: {batch_size}")

    success = 0
    new_failed = 0
    start_time = time.time()
    pending_rows = []  # Accumulate rows for batch insert

    for i, code in enumerate(codes):
        try:
            navs = provider.get_fund_nav(code)
            if not navs:
                failed.add(code)
                new_failed += 1
                continue

            for n in navs:
                pending_rows.append((
                    code,
                    n.date,
                    n.nav,
                    n.accum_nav,
                    n.day_growth,
                    "tushare",
                    datetime.now().isoformat(),
                ))

            total_rows += len(navs)
            completed.add(code)
            success += 1

        except Exception as e:
            console_error(f"NAV error for {code}: {e}")
            failed.add(code)
            new_failed += 1

        # Batch write + save progress every batch_size
        if (i + 1) % batch_size == 0 or i + 1 == total:
            if pending_rows:
                try:
                    db.executemany(
                        """INSERT OR REPLACE INTO fund_nav_history
                           (code, nav_date, nav, accum_nav, day_growth, source, fetched_at)
                           VALUES (?, ?, ?, ?, ?, ?, ?)""",
                        pending_rows,
                    )
                    db.commit()
                except sqlite3.OperationalError as e2:
                    console_error(f"DB batch write failed: {e2}")
                pending_rows.clear()

            elapsed = time.time() - start_time
            rate = (i + 1) / elapsed * 60 if elapsed > 0 else 0
            print(
                f"  [{i + 1}/{total}] OK {success}, FAIL {new_failed}, "
                f"rows {total_rows}, rate {rate:.1f} funds/min"
            )
            _save_progress(list(completed), list(failed), total_rows)

    db.close()
    elapsed = time.time() - start_time
    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] Done")
    print(f"  Total: {total}, OK: {success}, FAIL: {new_failed}")
    print(f"  Rows: {total_rows}, Time: {elapsed:.1f}s")

    return {"total": total, "success": success, "failed": new_failed, "rows": total_rows}


def main():
    parser = argparse.ArgumentParser(description="Batch backfill NAV via Tushare")
    parser.add_argument("--limit", type=int, default=0, help="Max funds (0=all)")
    parser.add_argument("--batch-size", type=int, default=100, help="Commit batch size")
    parser.add_argument("--incremental", action="store_true", help="Only backfill funds not updated in last 24h")
    args = parser.parse_args()

    result = backfill_nav_history(limit=args.limit, batch_size=args.batch_size, incremental=args.incremental)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
