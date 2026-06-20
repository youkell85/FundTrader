from datetime import date, timedelta
from unittest.mock import patch

import numpy as np

from app.allocation.config import ASSET_CLASSES
from app.allocation.data.historical_calibrator import HistoricalCalibrator
from app.allocation.data.long_window_producer import (
    REPRESENTATIVE_ETFS,
    build_long_window_stats,
    persist_long_window_stats,
)


def _prices(count: int = 760, start: float = 1.0, drift: float = 0.0002) -> dict[str, float]:
    values = {}
    price = start
    for index in range(count):
        price *= 1.0 + drift + (index % 5) * 0.00001
        values[f"2023-01-{(index % 28) + 1:02d}-{index:04d}"] = round(price, 6)
    return values


def _prices_with_tail_events(count: int = 760, start: float = 1.0) -> dict[str, float]:
    values = {}
    price = start
    first_day = date(2023, 1, 1)
    for index in range(count):
        shock = -0.04 if index > 0 and index % 95 == 0 else 0.0003
        price *= 1.0 + shock
        values[(first_day + timedelta(days=index)).isoformat()] = round(price, 6)
    return values


def _cache_for_all_assets() -> dict[str, dict[str, float]]:
    cache = {}
    for index, asset in enumerate(ASSET_CLASSES):
        code = REPRESENTATIVE_ETFS.get(asset)
        if code:
            cache[code] = _prices(start=1.0 + index * 0.1, drift=0.0001 + index * 0.00001)
    return cache


def _get_range_from(cache: dict[str, dict[str, float]]):
    def fake_get_range(code: str, _start: str, _end: str) -> dict[str, float]:
        return cache.get(code, {})

    return fake_get_range


def test_build_long_window_stats_returns_valid_snapshot():
    cache = _cache_for_all_assets()
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.side_effect = _get_range_from(cache)
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is not None
    assert set(snapshot["returns_long"]) == set(ASSET_CLASSES)
    assert set(snapshot["vols_long"]) == set(ASSET_CLASSES)
    assert len(snapshot["correlation_matrix"]) == len(ASSET_CLASSES)
    assert snapshot["long_window"]["window_start"]
    assert snapshot["long_window"]["window_end"]
    assert snapshot["long_window"]["n_observations"] >= 700
    assert snapshot["confidence_score"] >= 0.7


def test_snapshot_is_finite_and_matrix_is_symmetric():
    cache = _cache_for_all_assets()
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.side_effect = _get_range_from(cache)
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is not None
    for values in (snapshot["returns_long"], snapshot["vols_long"]):
        assert all(np.isfinite(float(value)) for value in values.values())

    matrix = np.asarray(snapshot["correlation_matrix"], dtype=float)
    assert matrix.shape == (len(ASSET_CLASSES), len(ASSET_CLASSES))
    assert np.all(np.isfinite(matrix))
    assert np.allclose(matrix, matrix.T)
    assert np.allclose(np.diag(matrix), 1.0)


def test_insufficient_coverage_returns_none():
    sparse = {"510300": _prices()}
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.side_effect = _get_range_from(sparse)
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is None


def test_empty_cache_returns_none():
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.return_value = {}
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is None


def test_snapshot_compatible_with_historical_calibrator():
    cache = _cache_for_all_assets()
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.side_effect = _get_range_from(cache)
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is not None
    result = HistoricalCalibrator(stats_snapshot=snapshot).calibrate_equilibrium_returns()
    assert result["source"] == "long_window_snapshot"
    assert result["window_start"] == snapshot["long_window"]["window_start"]
    assert result["confidence_score"] == snapshot["long_window"]["confidence_score"]


def test_snapshot_includes_real_jump_tail_stats():
    cache = {
        code: _prices_with_tail_events(start=1.0 + index * 0.1)
        for index, (asset, code) in enumerate(REPRESENTATIVE_ETFS.items())
        if code
    }
    with patch("app.allocation.data.long_window_producer.ETFPriceCache") as mock_cache:
        mock_cache.get_range.side_effect = _get_range_from(cache)
        snapshot = build_long_window_stats("2026-06-10")

    assert snapshot is not None
    tail_stats = snapshot["long_window"]["jump_tail_stats"]
    assert tail_stats["sample_size"] >= 700
    assert tail_stats["tail_count"] >= 3
    assert 0 < tail_stats["jump_probability"] <= 0.10
    assert tail_stats["jump_mean"] < 0
    assert tail_stats["jump_vol"] > 0
    assert tail_stats["source_assets"]


def test_persist_long_window_stats_calls_cache_key():
    snapshot = {"returns_long": {}, "vols_long": {}, "correlation_matrix": []}
    with patch("app.allocation.data.long_window_producer.StatsSnapshotCache") as mock_cache:
        persist_long_window_stats(snapshot)

    mock_cache.save.assert_called_once_with("long_window_stats", snapshot)


def test_module_does_not_import_live_fetch_libraries():
    import app.allocation.data.long_window_producer as producer

    names = set(producer.__dict__)
    assert "efinance" not in names
    assert "tushare" not in names
    assert "akshare" not in names
    assert "load_etf_history" not in names
