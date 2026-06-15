import unittest

from pydantic import ValidationError

from app.allocation.alert_engine import (
    MAX_ALERTS_PER_USER,
    _alerts_by_user,
    _alerts_lock,
    check_alerts,
    get_active_alerts,
)
from app.allocation.backtest.models import BacktestRequest
from app.allocation.models import AllocationRequest


class RequestValidationTest(unittest.TestCase):
    def test_allocation_request_rejects_unreasonable_age_and_amount(self):
        with self.assertRaises(ValidationError):
            AllocationRequest(age=12, amount=500000)

        with self.assertRaises(ValidationError):
            AllocationRequest(age=35, amount=-1)

    def test_allocation_request_rejects_invalid_target_date(self):
        with self.assertRaises(ValidationError):
            AllocationRequest(target_date="2026-99-99")

    def test_backtest_request_rejects_invalid_date_range(self):
        with self.assertRaises(ValidationError):
            BacktestRequest(start_date="2024-01-01", end_date="2024-01-01")

        with self.assertRaises(ValidationError):
            BacktestRequest(start_date="2020-01-01", end_date="2031-01-02")


class AlertStoreTest(unittest.TestCase):
    def setUp(self):
        with _alerts_lock:
            _alerts_by_user.clear()

    def test_alert_store_is_capped_per_user(self):
        user_id = "cap-test"
        for day in range(MAX_ALERTS_PER_USER + 5):
            check_alerts(
                target_weights={"cash": 1.0},
                current_weights={"cash": 0.0},
                user_id=user_id,
                last_rebalance_date=f"2024-01-{(day % 28) + 1:02d}",
            )

        self.assertLessEqual(len(get_active_alerts(user_id)), MAX_ALERTS_PER_USER)


if __name__ == "__main__":
    unittest.main()
