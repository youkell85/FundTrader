from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "populate-etf-cache.ps1"


def test_population_script_exists_and_is_dry_run_first():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "populate-etf-cache.ps1" in text
    assert "[switch]$Apply" in text
    assert '"mode": "apply" if args.apply else "dry_run"' in text
    assert '"wrote_cache": bool(args.apply)' in text


def test_dry_run_does_not_import_live_fetch_loader_before_apply():
    text = SCRIPT.read_text(encoding="utf-8")

    apply_index = text.index("def _apply_population")
    live_import_index = text.index("from app.allocation.backtest.historical_data import load_etf_history")
    assert live_import_index > apply_index


def test_population_script_does_not_persist_long_window_stats():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "StatsSnapshotCache.save" not in text
    assert "persist_long_window_stats" not in text


def test_population_script_reports_cache_counts():
    text = SCRIPT.read_text(encoding="utf-8")

    assert "ETFPriceCache.get_range" in text
    assert "window_rows" in text
    assert "total_rows" in text