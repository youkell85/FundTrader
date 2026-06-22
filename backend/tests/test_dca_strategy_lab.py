import os
import tempfile
import unittest
from unittest.mock import patch

from app.allocation.dca_strategy_lab import run_dca_strategy_lab
from app.allocation.models import DcaStrategyLabRequest
from app.storage import database
from app.storage.database import init_db


class DcaStrategyLabTest(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        with patch("app.storage.database.DB_PATH", self.db_path):
            database._local.conn = None
            init_db()

    def tearDown(self):
        if hasattr(database._local, "conn") and database._local.conn is not None:
            database._local.conn.close()
            database._local.conn = None
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def _request(self):
        return DcaStrategyLabRequest(
            fund_codes=["000001"],
            start_date="2020-01-01",
            end_date="2023-12-31",
            monthly_amount=1000,
            strategy_types=["fixed", "ma"],
        )

    def test_missing_nav_returns_missing_without_scores(self):
        with patch("app.storage.database.DB_PATH", self.db_path), \
            patch("app.allocation.dca_strategy_lab.fetch_real_nav_history", return_value=[]):
            result = run_dca_strategy_lab(self._request())

        self.assertEqual(result.data_quality.status, "missing")
        self.assertEqual(result.scores, [])

    def test_scores_real_nav_and_bounds_rolling_windows(self):
        nav = [{"date": f"202{i // 12}-{(i % 12) + 1:02d}-01", "nav": 1 + i / 1000} for i in range(60)]
        compare = {
            "strategies": {
                "fixed": {"annual_return": 5.0, "max_drawdown": -8.0, "sharpe_ratio": 0.5},
                "ma": {"annual_return": 6.0, "max_drawdown": -10.0, "sharpe_ratio": 0.6},
            }
        }
        with patch("app.storage.database.DB_PATH", self.db_path), \
            patch("app.allocation.dca_strategy_lab.fetch_real_nav_history", return_value=nav), \
            patch("app.allocation.dca_strategy_lab.run_strategy_compare", return_value=compare):
            result = run_dca_strategy_lab(self._request())

        self.assertEqual(result.data_quality.status, "real")
        self.assertEqual(len(result.scores), 2)
        self.assertEqual(result.best_strategy_id, result.scores[0].strategy_id)
        self.assertIn("rolling_starts=", result.evidence_refs[0].description)
        rolling_count = int(result.evidence_refs[0].description.split("rolling_starts=")[1].split(" ")[0])
        self.assertLessEqual(rolling_count, 36)


if __name__ == "__main__":
    unittest.main()
