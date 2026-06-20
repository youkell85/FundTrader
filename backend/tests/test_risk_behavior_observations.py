import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.allocation.models import AllocationRequest
from app.api.allocation import _record_behavior_observation
from app.storage.database import RiskBehaviorObservationStore, init_db


class RiskBehaviorObservationStoreTest(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        with patch("app.storage.database.DB_PATH", self.db_path):
            from app.storage.database import _local

            _local.conn = None
            init_db()

    def tearDown(self):
        from app.storage.database import _local

        if hasattr(_local, "conn") and _local.conn is not None:
            _local.conn.close()
            _local.conn = None
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def test_record_and_read_anonymous_behavior_observation(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            observation_id = RiskBehaviorObservationStore.record(
                observation_id="obs-1",
                source="test",
                risk_tolerance="balanced",
                effective_risk="aggressive",
                behavior_answers={"q1_drawdown": "add", "q2_rally": "chase"},
                behavior_score=1.2,
                question_count=2,
                age=35,
                amount=500000,
                horizon="medium",
                goal_type="wealth",
            )
            rows = RiskBehaviorObservationStore.recent()

        self.assertEqual(observation_id, "obs-1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["risk_tolerance"], "balanced")
        self.assertEqual(rows[0]["effective_risk"], "aggressive")
        self.assertEqual(rows[0]["age_bucket"], "30s")
        self.assertEqual(rows[0]["amount_bucket"], "500k_1m")
        self.assertEqual(rows[0]["behavior_answers"]["q1_drawdown"], "add")

    def test_empty_answers_are_not_recorded(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            observation_id = RiskBehaviorObservationStore.record(
                observation_id="obs-empty",
                source="test",
                risk_tolerance="balanced",
                effective_risk="balanced",
                behavior_answers={},
                behavior_score=None,
                question_count=0,
            )

        self.assertIsNone(observation_id)


class RiskBehaviorObservationApiTest(unittest.TestCase):
    def test_record_behavior_observation_uses_result_profile(self):
        request = AllocationRequest(
            age=35,
            amount=500000,
            risk_tolerance="balanced",
            behavior_answers={"q1_drawdown": "add"},
            preferred_tags=[],
        )
        result = SimpleNamespace(
            user_profile=SimpleNamespace(
                risk_tolerance="balanced",
                effective_risk="aggressive",
                behavior_score=1.0,
                behavior_question_count=1,
            )
        )

        with patch("app.api.allocation.RiskBehaviorObservationStore.record") as mock_record:
            _record_behavior_observation(request, result, "unit")

        kwargs = mock_record.call_args.kwargs
        self.assertEqual(kwargs["source"], "unit")
        self.assertEqual(kwargs["risk_tolerance"], "balanced")
        self.assertEqual(kwargs["effective_risk"], "aggressive")
        self.assertEqual(kwargs["behavior_answers"], {"q1_drawdown": "add"})

    def test_record_behavior_observation_skips_empty_answers(self):
        request = AllocationRequest(age=35, amount=500000, risk_tolerance="balanced", preferred_tags=[])
        result = SimpleNamespace(user_profile=SimpleNamespace(risk_tolerance="balanced"))

        with patch("app.api.allocation.RiskBehaviorObservationStore.record") as mock_record:
            _record_behavior_observation(request, result, "unit")

        mock_record.assert_not_called()
