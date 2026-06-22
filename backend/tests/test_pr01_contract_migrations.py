import os
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from app.storage import database
from app.storage.database import init_db


class Pr01ContractMigrationTest(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")

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

    def test_pr01_tables_and_columns_are_idempotent(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            database._local.conn = None
            init_db()
            init_db()

            with database.get_db() as conn:
                plan_columns = {
                    row["name"]
                    for row in conn.execute("PRAGMA table_info(allocation_plans)").fetchall()
                }
                table_names = {
                    row["name"]
                    for row in conn.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }

        self.assertTrue(
            {
                "owner_user_id",
                "plan_type",
                "client_profile_json",
                "policy_bands_json",
                "glide_path_json",
                "suitability_status",
                "data_status",
                "evidence_refs_json",
            }.issubset(plan_columns)
        )
        self.assertTrue(
            {
                "suitability_audit_log",
                "sales_talk_templates",
                "sales_talk_generations",
                "model_portfolios",
                "model_portfolio_holdings",
                "dca_strategy_runs",
                "professional_score_snapshots",
            }.issubset(table_names)
        )

    def test_pr01_migrates_preexisting_allocation_plans_table(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            """CREATE TABLE allocation_plans (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT 'legacy',
                description TEXT DEFAULT '',
                request_json TEXT NOT NULL,
                response_json TEXT NOT NULL,
                risk_profile TEXT NOT NULL,
                is_favorite INTEGER DEFAULT 0,
                is_archived INTEGER DEFAULT 0
            )"""
        )
        conn.commit()
        conn.close()

        with patch("app.storage.database.DB_PATH", self.db_path):
            database._local.conn = None
            init_db()
            with database.get_db() as db_conn:
                plan_columns = {
                    row["name"]
                    for row in db_conn.execute("PRAGMA table_info(allocation_plans)").fetchall()
                }

        self.assertIn("owner_user_id", plan_columns)
        self.assertIn("plan_type", plan_columns)
        self.assertIn("data_status", plan_columns)


if __name__ == "__main__":
    unittest.main()
