"""Batch backfill quarterly fund data from Tushare to SQLite.

Populates:
  - fund_holdings_snapshot (stock holdings + asset allocation)
  - fund_detail_quarterly_snapshot (scale, turnover)
  - fund_manager_history_snapshot (manager changes)

Usage:
    cd backend && python app/scripts/backfill_quarterly_tushare.py [--limit N] [--batch-size N]
"""

import logging

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
PROGRESS_FILE = Path(__file__).resolve().parent / ".backfill_quarterly_tushare_progress.json"

# NOTE: Do NOT modify os.environ here. TushareProvider handles its own connection.


def _load_progress():
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
        logging.exception("Ignored non-fatal exception")
    return {"completed": [], "failed": [], "rows": 0}


def _save_progress(completed, failed, rows):
    try:
        with open(PROGRESS_FILE, "w", encoding="utf-8") as f:
            json.dump(
                {
                    "completed": sorted(set(completed)),
                    "failed": sorted(set(failed)),
                    "rows": rows,
                    "updated_at": datetime.now().isoformat(),
                },
                f, ensure_ascii=False, indent=2,
            )
    except Exception as e:
        console_error(f"save progress failed: {e}")


def get_target_codes(db: sqlite3.Connection, limit=0):
    """浠庡凡鏈夎繛鎺ヨ鍙栫洰鏍囦唬鐮侊紝閬垮厤寰幆鍐呭弽澶嶅垱寤鸿繛鎺ャ€?""
    c = db.execute("SELECT code FROM fund_master WHERE is_active = 1 ORDER BY code")
    codes = [r["code"] for r in c.fetchall()]
    if limit > 0:
        codes = codes[:limit]
    return codes


def _asset_alloc_from_holdings(holdings):
    """Infer asset allocation from holdings ratios."""
    if not holdings:
        return []
    total_stock = sum(h.ratio for h in holdings if h.ratio is not None)
    result = []
    if total_stock > 0:
        result.append({"name": "鑲＄エ", "ratio": round(total_stock / 100, 4)})
    # Tushare portfolio only gives stock holdings, bond/cash are not directly available
    # Mark as inferred from stock ratio
    return result


def backfill_quarterly(limit=0, batch_size=50):
    progress = _load_progress()
    completed = set(progress.get("completed", []))
    failed = set(progress.get("failed", []))
    total_rows = progress.get("rows", 0)

    # Single persistent DB connection
    db = sqlite3.connect(DB_PATH, timeout=30)
    db.execute("PRAGMA busy_timeout = 30000")
    db.row_factory = sqlite3.Row

    codes = get_target_codes(db, limit)
    codes = [c for c in codes if c not in completed]

    if not codes:
        print("All funds already have quarterly data. Skip.")
        db.close()
        return {"total": 0, "success": 0, "failed": 0}

    provider = TushareProvider()
    if not provider.is_available():
        print("Tushare not available. Check TUSHARE_TOKEN.")
        db.close()
        return {"total": 0, "success": 0, "failed": 0}

    total = len(codes)
    print(f"[{datetime.now().strftime('%H:%M:%S')}] Start quarterly backfill via Tushare")
    print(f"  Target: {total} funds (skipped {len(completed)})")
    print(f"  Batch size: {batch_size}")

    success = 0
    new_failed = 0
    start_time = time.time()
    now = datetime.now().isoformat()

    for i, code in enumerate(codes):
        has_any = False
        report_date = ""

        try:
            # 1. Holdings
            holdings = provider.get_fund_holdings(code)
            if holdings:
                has_any = True
                report_date = holdings[0].quarter if holdings[0].quarter else ""
                holdings_json = json.dumps(
                    [
                        {
                            "stockName": h.name,
                            "stockCode": h.code,
                            "ratio": h.ratio,
                            "industry": h.industry,
                            "quarter": h.quarter,
                        }
                        for h in holdings
                    ],
                    ensure_ascii=False,
                )
                asset_alloc = _asset_alloc_from_holdings(holdings)
                asset_json = json.dumps(asset_alloc, ensure_ascii=False)

                db.execute(
                    """INSERT INTO fund_holdings_snapshot
                       (code, report_date, holdings_json, asset_allocation_json, source, data_quality, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(code, report_date) DO UPDATE SET
                         holdings_json = excluded.holdings_json,
                         asset_allocation_json = excluded.asset_allocation_json,
                         source = excluded.source,
                         updated_at = excluded.updated_at""",
                    (code, report_date, holdings_json, asset_json, "tushare", "backfilled", now),
                )
                total_rows += 1

            # 2. Scale
            scale = provider.get_fund_scale(code)
            if scale:
                has_any = True
                report_date_for_q = report_date or (scale.end_date if scale.end_date else now[:10])
                db.execute(
                    """INSERT INTO fund_detail_quarterly_snapshot
                       (code, report_date, holder_structure_json, bond_allocation_json, bond_holdings_json,
                        total_scale, turnover_rate, source, data_quality, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(code, report_date) DO UPDATE SET
                         total_scale = COALESCE(excluded.total_scale, fund_detail_quarterly_snapshot.total_scale),
                         source = excluded.source,
                         updated_at = excluded.updated_at""",
                    (code, report_date_for_q, "[]", "[]", "[]",
                     scale.total_nav, None, "tushare", "backfilled", now),
                )
                total_rows += 1

            # 3. Manager
            mgr = provider.get_fund_manager(code)
            if mgr and mgr.get("name"):
                has_any = True
                db.execute(
                    """INSERT INTO fund_manager_history_snapshot
                       (code, manager_name, start_date, end_date, total_return, annualized_return, rank_json, source, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(code, manager_name, start_date) DO UPDATE SET
                         end_date = excluded.end_date,
                         total_return = excluded.total_return,
                         source = excluded.source,
                         updated_at = excluded.updated_at""",
                    (code, mgr["name"], mgr["begin_date"], mgr.get("end_date") or "",
                     mgr.get("reward"), None, "{}", "tushare", now),
                )
                total_rows += 1

            if has_any:
                completed.add(code)
                success += 1
            else:
                failed.add(code)
                new_failed += 1

        except Exception as e:
            console_error(f"Quarterly error for {code}: {e}")
            failed.add(code)
            new_failed += 1

        # Commit every batch_size
        if (i + 1) % batch_size == 0 or i + 1 == total:
            db.commit()
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
    parser = argparse.ArgumentParser(description="Batch backfill quarterly data via Tushare")
    parser.add_argument("--limit", type=int, default=0, help="Max funds (0=all)")
    parser.add_argument("--batch-size", type=int, default=50, help="Commit batch size")
    args = parser.parse_args()

    result = backfill_quarterly(limit=args.limit, batch_size=args.batch_size)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

