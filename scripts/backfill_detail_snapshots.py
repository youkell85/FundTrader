#!/usr/bin/env python3
"""回填基金详情页快照数据：净值历史、持有人结构、债券配置、规模历史、经理历史、费率。

用法：
    python scripts/backfill_detail_snapshots.py [--codes 512100,519778] [--limit 50]
"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from app.storage.database import FundDataStore, get_db_context
from app.services.fund_service import (
    _fetch_eastmoney_holder_report_pdf_text,
    _parse_holder_structure_from_report_text,
    _parse_bond_allocation_from_report_text,
    _parse_asset_allocation_from_report_text,
    _persist_quarterly_snapshot_field,
    _backfill_scale_history_from_tushare,
    _persist_manager_history_snapshot,
    _parse_manager_history_from_report_text,
    get_fund_manager_report,
    console_error,
    _safe_float,
)


def _get_nav_history_from_efinance(code: str) -> list[dict]:
    try:
        from app.data.efinance_fetcher import get_fund_nav_history
        raw = get_fund_nav_history(code)
        clean = []
        for item in raw or []:
            nav_date = str(item.get("date") or item.get("nav_date") or "")[:10]
            nav = _safe_float(item.get("nav") or item.get("单位净值") or item.get("nav_value"))
            accum_nav = _safe_float(item.get("acc_nav") or item.get("累计净值"))
            if nav_date and nav is not None and nav > 0:
                clean.append({
                    "nav_date": nav_date, "nav": nav, "accum_nav": accum_nav,
                    "day_growth": _safe_float(item.get("day_growth") or item.get("日增长率")),
                })
        clean.sort(key=lambda r: r["nav_date"])
        return clean
    except Exception as e:
        console_error(f"efinance nav fetch failed for {code}: {e}")
        return []


def _get_fees_from_efinance(code: str) -> dict | None:
    try:
        from app.data.efinance_fetcher import get_fund_fees
        raw = get_fund_fees(code)
        if not raw:
            return None
        return {"fee_manage": raw.get("feeManage"), "fee_custody": raw.get("feeCustody")}
    except Exception as e:
        console_error(f"efinance fees fetch failed for {code}: {e}")
        return None


def _upsert_quarterly_scale(code: str, report_date: str, total_scale: float, source: str = "efinance"):
    try:
        with get_db_context() as conn:
            conn.execute(
                """INSERT INTO fund_detail_quarterly_snapshot
                   (code, report_date, holder_structure_json, bond_allocation_json, bond_holdings_json,
                    total_scale, turnover_rate, source, data_quality, updated_at)
                   VALUES (?, ?, '[]', '[]', '[]', ?, NULL, ?, 'efinance_backfill', ?)
                   ON CONFLICT(code, report_date) DO UPDATE SET
                     total_scale = excluded.total_scale,
                     source = excluded.source,
                     updated_at = excluded.updated_at""",
                (code, report_date, total_scale, source, datetime.now().isoformat()),
            )
    except Exception as e:
        console_error(f"quarterly scale upsert failed for {code}: {e}")


def _upsert_metrics_fees(code: str, fees: dict):
    try:
        with get_db_context() as conn:
            conn.execute(
                """INSERT INTO fund_metrics_snapshot (code, fee_manage, fee_custody, source, updated_at)
                   VALUES (?, ?, ?, 'efinance_backfill', ?)
                   ON CONFLICT(code) DO UPDATE SET
                     fee_manage = COALESCE(excluded.fee_manage, fee_manage),
                     fee_custody = COALESCE(excluded.fee_custody, fee_custody),
                     updated_at = excluded.updated_at""",
                (code, fees.get("fee_manage"), fees.get("fee_custody"), datetime.now().isoformat()),
            )
    except Exception as e:
        console_error(f"metrics fees upsert failed for {code}: {e}")


def backfill_fund(code: str) -> dict:
    result = {"code": code, "nav": False, "holder": False, "bond": False, "scale": False, "manager": False, "fees": False}

    # 1. 净值历史
    nav_records = _get_nav_history_from_efinance(code)
    if nav_records and len(nav_records) >= 2:
        try:
            saved = FundDataStore.save_nav_history_batch(code, nav_records, source="efinance_backfill")
            result["nav"] = saved > 0
            print(f"  nav: saved {saved} records")
        except Exception as e:
            print(f"  nav: FAILED - {e}")
    else:
        print("  nav: no data from efinance")

    # 2. 持有人结构 + 债券配置（从 Eastmoney PDF）
    report = _fetch_eastmoney_holder_report_pdf_text(code)
    if report:
        report_date = report.get("report_date", "")
        holder_parsed = _parse_holder_structure_from_report_text(report["text"], report_date)
        if holder_parsed:
            _persist_quarterly_snapshot_field(code, report_date, holder_structure=holder_parsed, source="eastmoney:periodic_report_pdf")
            result["holder"] = True
            print(f"  holder: saved {len(holder_parsed)} periods")
        bond_parsed = _parse_bond_allocation_from_report_text(report["text"])
        if bond_parsed:
            _persist_quarterly_snapshot_field(code, report_date, bond_allocation=bond_parsed, source="eastmoney:periodic_report_pdf")
            result["bond"] = True
            print(f"  bond: saved {len(bond_parsed)} types")
        asset_parsed = _parse_asset_allocation_from_report_text(report["text"], report_date)
        if asset_parsed and report_date:
            try:
                FundDataStore.save_holdings_snapshot(
                    code=code, report_date=report_date, holdings=[], asset_allocation=asset_parsed,
                    source="eastmoney:periodic_report_pdf", data_quality="report_pdf",
                )
                print(f"  asset_allocation: saved {len(asset_parsed)} items")
            except Exception as e:
                print(f"  asset_allocation: FAILED - {e}")
    else:
        print("  holder/bond: no PDF report available")

    # 3. 规模历史（从 tushare fund_share x unit_nav）
    try:
        tushare_rows = _backfill_scale_history_from_tushare(code, 40, [])
        if tushare_rows:
            result["scale"] = True
            print(f"  scale: backfilled {len(tushare_rows)} periods from tushare")
        else:
            print("  scale: no tushare data")
    except Exception as e:
        print(f"  scale: FAILED - {e}")

    # 4. 基金经理历史
    try:
        from app.data.providers.tushare_provider import TushareProvider
        manager = TushareProvider().get_fund_manager(code) or {}
        if manager.get("name"):
            manager_rows = [{
                "managerName": manager.get("name"),
                "startDate": manager.get("begin_date") or None,
                "endDate": manager.get("end_date") or None,
                "totalReturn": _safe_float(manager.get("reward")),
                "annualizedReturn": None,
                "rank": None,
            }]
            _persist_manager_history_snapshot(code, manager_rows, "tushare:fund_manager")
            result["manager"] = True
            print("  manager: saved from tushare")
    except Exception as e:
        print(f"  manager tushare: FAILED - {e}")

    if not result["manager"]:
        try:
            report_payload = get_fund_manager_report(code)
            report_text = (report_payload or {}).get("report") or ""
            report_rows = _parse_manager_history_from_report_text(report_text, (report_payload or {}).get("period"))
            if report_rows:
                source = (report_payload or {}).get("source") or "eastmoney:fund_announcement_report"
                _persist_manager_history_snapshot(code, report_rows, source)
                result["manager"] = True
                print(f"  manager: saved {len(report_rows)} from report")
        except Exception as e:
            print(f"  manager report: FAILED - {e}")

    # 5. 费率
    fees = _get_fees_from_efinance(code)
    if fees and (fees.get("fee_manage") is not None or fees.get("fee_custody") is not None):
        _upsert_metrics_fees(code, fees)
        result["fees"] = True
        print(f"  fees: saved manage={fees.get('fee_manage')}, custody={fees.get('fee_custody')}")
    else:
        print("  fees: no data from efinance")

    return result


def main():
    parser = argparse.ArgumentParser(description="回填基金详情页快照数据")
    parser.add_argument("--codes", help="指定基金代码，逗号分隔")
    parser.add_argument("--limit", type=int, default=0, help="最多处理多少只基金（0=全部）")
    args = parser.parse_args()

    if args.codes:
        codes = [c.strip() for c in args.codes.split(",") if c.strip()]
    else:
        with get_db_context() as conn:
            rows = conn.execute("SELECT DISTINCT code FROM fund_master").fetchall()
            codes = [row["code"] for row in rows]

    if args.limit > 0:
        codes = codes[:args.limit]

    print(f"Backfilling {len(codes)} funds...")
    stats = {"nav": 0, "holder": 0, "bond": 0, "scale": 0, "manager": 0, "fees": 0}
    for i, code in enumerate(codes):
        print(f"\n[{i+1}/{len(codes)}] {code}")
        try:
            r = backfill_fund(code)
            for key in stats:
                if r.get(key):
                    stats[key] += 1
        except Exception as e:
            print(f"  FAILED: {e}")
        if i < len(codes) - 1:
            time.sleep(1)

    print(f"\n=== Summary ===")
    print(f"Total funds: {len(codes)}")
    for key, count in stats.items():
        print(f"  {key}: {count}/{len(codes)}")


if __name__ == "__main__":
    main()
