import os
import tempfile
import unittest
from unittest.mock import patch

from app.allocation.models import SalesFact, SalesNarrativeRequest
from app.services.compliance_check import check_compliance
from app.services.talk_generator import generate_sales_narrative
from app.storage import database
from app.storage.database import init_db


class SalesGuardrailsTest(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        with patch("app.storage.database.DB_PATH", self.db_path):
            database._local.conn = None
            init_db()

    def tearDown(self):
        if hasattr(database._local, "conn") and database._local.conn is not None:
            try:
                database._local.conn.close()
            except Exception:
                pass
            database._local.conn = None
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def _audit_count(self) -> int:
        with patch("app.storage.database.DB_PATH", self.db_path), database.get_db() as conn:
            return conn.execute("SELECT COUNT(*) AS c FROM suitability_audit_log").fetchone()["c"]

    def test_forbidden_claims_are_blocked(self):
        result = check_compliance("这只基金保本，而且一定能涨。")
        self.assertEqual(result.level, "block")
        self.assertIn("保本", result.forbidden_claims)
        self.assertIn("一定能涨", result.forbidden_claims)

    def test_conservative_client_high_risk_product_is_rejected_and_audited(self):
        req = SalesNarrativeRequest(
            scene="product_recommendation",
            client_profile={"client_risk_level": "conservative"},
            fund_code="000001",
            facts=[
                SalesFact(key="fund_name", value="测试基金", source="unit-test", status="real"),
                SalesFact(key="fund_code", value="000001", source="unit-test", status="real"),
                SalesFact(key="risk_level", value="balanced", source="unit-test", status="real"),
                SalesFact(key="as_of", value="2026-06-22", source="unit-test", status="real"),
            ],
        )

        with patch("app.storage.database.DB_PATH", self.db_path):
            result = generate_sales_narrative(req)

        self.assertEqual(result.content, "")
        self.assertEqual(result.suitability.decision, "rejected")
        self.assertEqual(result.data_quality.status, "rejected")
        self.assertEqual(self._audit_count(), 1)

    def test_missing_required_facts_return_missing_without_placeholder(self):
        req = SalesNarrativeRequest(
            scene="product_recommendation",
            client_profile={"client_risk_level": "balanced"},
            facts=[
                SalesFact(key="fund_code", value="000001", source="unit-test", status="real"),
                SalesFact(key="risk_level", value="balanced", source="unit-test", status="real"),
            ],
        )

        with patch("app.storage.database.DB_PATH", self.db_path):
            result = generate_sales_narrative(req)

        self.assertEqual(result.content, "")
        self.assertEqual(result.data_quality.status, "missing")
        self.assertIn("fund_name", result.missing_reason)
        self.assertEqual(self._audit_count(), 1)


if __name__ == "__main__":
    unittest.main()
