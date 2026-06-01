"""Idempotent migration/bootstrap for FundTrader fund data center tables."""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.storage.database import FundDataStore, init_db  # noqa: E402


if __name__ == "__main__":
    init_db()
    FundDataStore.bootstrap_from_legacy()
    status = FundDataStore.data_status()
    print("FUND_DATA_CENTER_MIGRATION_OK")
    for table, count in status["tables"].items():
        print(f"{table}: {count}")
