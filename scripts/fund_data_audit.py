"""Read-only FundTrader data architecture audit.

Reports table counts, cache file counts and source-code external API call
sites. It does not mutate the database or filesystem.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "backend" / "data" / "fundtrader.db"
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/tmp/fundtrader_cache"))

TABLES = [
    "fund_master",
    "fund_quote_snapshot",
    "fund_nav_history",
    "fund_metrics_snapshot",
    "fund_holdings_snapshot",
    "fund_data_job",
    "external_api_call_log",
    "fund_snapshot",
    "fund_pool",
    "fund_nav_cache",
    "stats_snapshot",
]

PATTERNS = [
    "fund_open_fund_rank_em",
    "efinance",
    "eastmoney",
    "tencent",
    "push2.eastmoney",
    "fundgz.1234567",
    "getFundAnalysisBatch",
    "pageSize: 1000",
    "page_size: 5000",
]


def table_counts() -> None:
    print("== SQLite table counts ==")
    if not DB_PATH.exists():
        print(f"missing database: {DB_PATH}")
        return
    with sqlite3.connect(DB_PATH) as conn:
        for table in TABLES:
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            except sqlite3.Error as exc:
                count = f"missing ({exc})"
            print(f"{table}: {count}")


def cache_counts() -> None:
    print("\n== Cache files ==")
    if not CACHE_DIR.exists():
        print(f"missing cache dir: {CACHE_DIR}")
        return
    files = [p for p in CACHE_DIR.rglob("*") if p.is_file()]
    total_bytes = sum(p.stat().st_size for p in files)
    print(f"path: {CACHE_DIR}")
    print(f"files: {len(files)}")
    print(f"size_mb: {total_bytes / 1024 / 1024:.2f}")


def source_call_sites() -> None:
    print("\n== External API and large-request call sites ==")
    roots = [ROOT / "backend", ROOT / "frontend"]
    for path in [p for root in roots for p in root.rglob("*") if p.suffix in {".py", ".ts", ".tsx"}]:
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            if any(pattern in line for pattern in PATTERNS):
                rel = path.relative_to(ROOT)
                print(f"{rel}:{lineno}: {line.strip()[:180]}")


if __name__ == "__main__":
    table_counts()
    cache_counts()
    source_call_sites()
