"""
Storage Owner Isolation Tests — Phase 1 Step 6

验证: 已保存方案严格按用户隔离，旧无 owner 方案不泄漏。
"""
import json
import os
import sqlite3
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.services.analysis_service import ensure_exchange_fund_holdings_snapshot
from app.services.fund_service import ensure_exchange_fund_snapshot
from app.storage.database import Database, FundDataStore, UserStore, init_db


class StorageOwnerIsolationTest(unittest.TestCase):
    """后端 owner isolation 测试。"""

    def setUp(self):
        """为每个测试创建独立临时数据库。"""
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        # Patch DB_PATH so init creates a fresh db per test
        with patch("app.storage.database.DB_PATH", self.db_path):
            # Clear thread-local cached connection so new DB is used
            from app.storage.database import _local
            _local.conn = None
            init_db()
            UserStore.seed_admin()
            # Register two distinct users
            self.user_a = UserStore.register("user_a", "password_a", "User A")
            self.user_b = UserStore.register("user_b", "password_b", "User B")
            self.assertIsNotNone(self.user_a)
            self.assertIsNotNone(self.user_b)
            self.user_a_id = self.user_a["id"]
            self.user_b_id = self.user_b["id"]

    def tearDown(self):
        """删除临时数据库。"""
        from app.storage.database import _local
        if hasattr(_local, "conn") and _local.conn is not None:
            try:
                _local.conn.close()
            except Exception:
                pass
            _local.conn = None
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def _save_plan_for(self, name: str, owner_id: str) -> str:
        """Helper: 为指定用户保存方案。"""
        with patch("app.storage.database.DB_PATH", self.db_path):
            plan_id = f"plan-{name.lower().replace(' ', '-')[:16]}"
            return Database.save_plan(
                plan_id=plan_id,
                name=name,
                request={"age": 35, "amount": 500000, "risk_tolerance": "balanced"},
                response={"meta": {"generated_at": "2026-01-01T00:00:00"}, "saa": {"expected_return": 5.0}},
                risk_profile="balanced",
                description=f"desc-{name}",
                owner_user_id=owner_id,
            )

    def _save_legacy_plan(self, name: str) -> str:
        """Helper: 保存无 owner 的旧方案（owner_user_id=None）。"""
        with patch("app.storage.database.DB_PATH", self.db_path):
            plan_id = f"legacy-{name.lower().replace(' ', '-')[:12]}"
            return Database.save_plan(
                plan_id=plan_id,
                name=name,
                request={"age": 40},
                response={"meta": {"generated_at": "2025-01-01T00:00:00"}},
                risk_profile="conservative",
                owner_user_id=None,
            )

    # ─── 1. user A 保存的方案，user A 能 list/get/export ───────────────────────
    def test_user_a_can_list_own_plans(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            self._save_plan_for("Plan A1", self.user_a_id)
            self._save_plan_for("Plan A2", self.user_a_id)
            plans = Database.list_plans(owner_user_id=self.user_a_id)
            self.assertEqual(len(plans), 2)
            self.assertEqual(plans[0]["name"], "Plan A2")  # DESC order
            self.assertEqual(plans[1]["name"], "Plan A1")

    def test_user_a_can_get_own_plan(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            pid = self._save_plan_for("Plan A3", self.user_a_id)
            plan = Database.get_plan(pid, owner_user_id=self.user_a_id)
            self.assertIsNotNone(plan)
            self.assertEqual(plan["name"], "Plan A3")

    # ─── 2. user B 不能 list/get/update/delete user A 的方案 ────────────────────
    def test_user_b_cannot_list_user_a_plans(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            self._save_plan_for("Plan A4", self.user_a_id)
            plans = Database.list_plans(owner_user_id=self.user_b_id)
            self.assertEqual(len(plans), 0)

    def test_user_b_cannot_get_user_a_plan(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            pid = self._save_plan_for("Plan A5", self.user_a_id)
            plan = Database.get_plan(pid, owner_user_id=self.user_b_id)
            self.assertIsNone(plan)

    def test_user_b_cannot_update_user_a_plan(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            pid = self._save_plan_for("Plan A6", self.user_a_id)
            ok = Database.update_plan(pid, name="Hacked", owner_user_id=self.user_b_id)
            self.assertFalse(ok)
            # Verify unchanged
            plan = Database.get_plan(pid, owner_user_id=self.user_a_id)
            self.assertEqual(plan["name"], "Plan A6")

    def test_user_b_cannot_delete_user_a_plan(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            pid = self._save_plan_for("Plan A7", self.user_a_id)
            ok = Database.delete_plan(pid, owner_user_id=self.user_b_id)
            self.assertFalse(ok)
            # Verify still exists
            plan = Database.get_plan(pid, owner_user_id=self.user_a_id)
            self.assertIsNotNone(plan)

    # ─── 3. 未登录访问应返回 401（由 API 层处理，这里验证 Database 层语义）──────
    def test_no_owner_filter_does_not_return_legacy(self):
        """不带 owner_user_id 的 list 不应返回 legacy 无 owner 方案。"""
        with patch("app.storage.database.DB_PATH", self.db_path):
            self._save_legacy_plan("Old Plan")
            plans = Database.list_plans()  # no owner filter
            self.assertEqual(len(plans), 0)
            count = Database.count_plans()
            self.assertEqual(count, 0)

    # ─── 4. owner_user_id 为空的 legacy plan 不出现在普通用户列表 ───────────────
    def test_legacy_plan_not_visible_to_user_a(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            legacy_id = self._save_legacy_plan("Legacy")
            self._save_plan_for("Plan A8", self.user_a_id)
            # list
            plans = Database.list_plans(owner_user_id=self.user_a_id)
            self.assertEqual(len(plans), 1)
            self.assertEqual(plans[0]["name"], "Plan A8")
            # get: legacy not accessible
            plan = Database.get_plan(legacy_id, owner_user_id=self.user_a_id)
            self.assertIsNone(plan)
            # update
            ok = Database.update_plan(legacy_id, name="Tried", owner_user_id=self.user_a_id)
            self.assertFalse(ok)
            # delete
            ok = Database.delete_plan(legacy_id, owner_user_id=self.user_a_id)
            self.assertFalse(ok)

    # ─── 5. clone 后新方案 owner_user_id 是当前用户 ─────────────────────────────
    def test_clone_inherits_current_user(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            pid = self._save_plan_for("Original", self.user_a_id)
            # Simulate clone by saving with new id and user_b as owner
            new_id = "plan-clone-001"
            original = Database.get_plan(pid, owner_user_id=self.user_a_id)
            Database.save_plan(
                plan_id=new_id,
                name=f"{original['name']} (副本)",
                request=original["request"],
                response=original["response"],
                risk_profile=original["risk_profile"],
                description=original["description"],
                owner_user_id=self.user_b_id,
            )
            # user_b can see it
            cloned = Database.get_plan(new_id, owner_user_id=self.user_b_id)
            self.assertIsNotNone(cloned)
            self.assertIn("副本", cloned["name"])
            # user_a cannot see it
            not_found = Database.get_plan(new_id, owner_user_id=self.user_a_id)
            self.assertIsNone(not_found)

    def test_count_plans_respects_owner_filter(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            self._save_plan_for("Plan A9", self.user_a_id)
            self._save_plan_for("Plan A10", self.user_a_id)
            self._save_plan_for("Plan B1", self.user_b_id)
            self.assertEqual(Database.count_plans(owner_user_id=self.user_a_id), 2)
            self.assertEqual(Database.count_plans(owner_user_id=self.user_b_id), 1)

    def test_risk_profile_filter_with_owner(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            self._save_plan_for("Conservative", self.user_a_id)  # balanced default
            # save with conservative risk_profile
            Database.save_plan(
                plan_id="plan-conservative",
                name="Truly Conservative",
                request={"age": 50},
                response={"meta": {"generated_at": "2026-01-01"}},
                risk_profile="conservative",
                owner_user_id=self.user_a_id,
            )
            plans = Database.list_plans(owner_user_id=self.user_a_id, risk_profile="conservative")
            self.assertEqual(len(plans), 1)
            self.assertEqual(plans[0]["name"], "Truly Conservative")


class FundHoldingsSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        with patch("app.storage.database.DB_PATH", self.db_path):
            from app.storage.database import _local, _qcache
            _local.conn = None
            _qcache.invalidate()
            init_db()

    def tearDown(self):
        from app.storage.database import _local, _qcache
        if hasattr(_local, "conn") and _local.conn is not None:
            try:
                _local.conn.close()
            except Exception:
                pass
            _local.conn = None
        _qcache.invalidate()
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def test_save_holdings_snapshot_updates_snapshot_facade(self):
        with patch("app.storage.database.DB_PATH", self.db_path):
            FundDataStore.save_quote_batch([
                {
                    "code": "000001",
                    "name": "Test Fund",
                    "type": "混合型",
                    "nav": 1.23,
                    "updated_at": "2026-01-01T00:00:00",
                }
            ])
            before = FundDataStore.get_snapshot("000001")
            self.assertEqual(before.get("holdings"), None)

            saved = FundDataStore.save_holdings_snapshot(
                code="000001",
                report_date="20260331",
                holdings=[{
                    "stockName": "浦发银行",
                    "stockCode": "600000.SH",
                    "ratio": 8.5,
                    "industry": "银行",
                    "quarter": "20260331",
                }],
                asset_allocation=[{"name": "股票", "ratio": 75.94}],
                source="unit-test",
                data_quality="analysis",
            )
            after = FundDataStore.get_snapshot("000001")

        self.assertEqual(saved, 1)
        self.assertEqual(len(after["holdings"]), 1)
        self.assertEqual(after["holdings"][0]["stockName"], "浦发银行")
        self.assertEqual(after["asset_allocation"][0]["name"], "股票")

    def test_exchange_fund_snapshot_is_backfilled_from_nav_history(self):
        nav_records = [
            {"date": "2025-01-02", "nav": 1.0, "acc_nav": 1.0},
            {"date": "2025-06-02", "nav": 1.1, "acc_nav": 1.1},
            {"date": "2026-01-02", "nav": 1.2, "acc_nav": 1.2},
        ]
        with patch("app.storage.database.DB_PATH", self.db_path), \
            patch("app.data.efinance_fetcher.get_fund_nav_history", return_value=nav_records):
            snapshot = ensure_exchange_fund_snapshot("510300")
            stored = FundDataStore.get_snapshot("510300")

        self.assertIsNotNone(snapshot)
        self.assertIsNotNone(stored)
        self.assertEqual(stored["code"], "510300")
        self.assertEqual(stored["name"], "510300 ETF")
        self.assertEqual(stored["type"], "ETF")
        self.assertFalse(stored["is_xinjihui"])
        self.assertEqual(stored["nav"], 1.2)
        self.assertEqual(stored["nav_date"], "2026-01-02")
        self.assertEqual(len(stored["nav_data"]), 3)
        self.assertGreater(stored["near_1y"], 0)

    def test_exchange_fund_snapshot_refreshes_missing_quote_with_existing_nav_history(self):
        nav_records = [
            {"nav_date": "2025-01-02", "nav": 1.0, "accum_nav": 1.0},
            {"nav_date": "2099-01-02", "nav": 1.2, "accum_nav": 1.2},
        ]
        with patch("app.storage.database.DB_PATH", self.db_path):
            FundDataStore.save_quote_batch([
                {
                    "code": "512100",
                    "name": "512100 ETF",
                    "type": "ETF",
                    "updated_at": "2026-01-01T00:00:00",
                }
            ])
            FundDataStore.save_nav_history_batch("512100", nav_records, source="unit-test")
            before = FundDataStore.get_snapshot("512100")
            snapshot = ensure_exchange_fund_snapshot("512100")

        self.assertEqual(before["nav"], 0)
        self.assertEqual(before["nav_date"], "2026-01-01")
        self.assertEqual(snapshot["nav"], 1.2)
        self.assertEqual(snapshot["nav_date"], "2099-01-02")
        self.assertEqual(len(snapshot["nav_data"]), 2)

    def test_exchange_fund_holdings_snapshot_is_backfilled_from_tushare(self):
        class FakeProvider:
            def is_available(self):
                return True

            def get_fund_holdings(self, code):
                return [
                    SimpleNamespace(
                        name="Test Stock",
                        code="300750.SZ",
                        ratio=19.73,
                        industry="Power",
                        quarter="20260331",
                        source="Tushare fund_portfolio:159915.SZ",
                        updated_at="20260331",
                    )
                ]

        with patch("app.storage.database.DB_PATH", self.db_path), \
            patch("app.services.analysis_service.TushareProvider", return_value=FakeProvider()), \
            patch(
                "app.services.analysis_service._fetch_real_asset_allocation",
                return_value=[{"name": "股票", "ratio": 57.19, "report_date": "20260331", "source": "tushare"}],
            ):
            FundDataStore.save_quote_batch([
                {
                    "code": "159915",
                    "name": "159915 ETF",
                    "type": "ETF",
                    "nav": 3.82,
                    "updated_at": "2026-01-01T00:00:00",
                }
            ])
            snapshot = ensure_exchange_fund_holdings_snapshot("159915")

        self.assertIsNotNone(snapshot)
        self.assertEqual(len(snapshot["holdings"]), 1)
        self.assertEqual(snapshot["holdings"][0]["code"], "300750.SZ")
        self.assertEqual(snapshot["asset_allocation"][0]["name"], "股票")

    def test_init_db_adds_data_version_to_existing_fund_master(self):
        old_fd, old_path = tempfile.mkstemp(suffix=".db")
        os.close(old_fd)
        try:
            conn = sqlite3.connect(old_path)
            conn.execute(
                """CREATE TABLE fund_master (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    fund_type TEXT DEFAULT '',
                    company TEXT DEFAULT '',
                    tags_json TEXT DEFAULT '[]',
                    share_class_group TEXT DEFAULT '',
                    share_class TEXT DEFAULT '',
                    is_xinjihui INTEGER DEFAULT 0,
                    is_preferred INTEGER DEFAULT 0,
                    is_active INTEGER DEFAULT 1,
                    data_quality TEXT DEFAULT 'unknown',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )"""
            )
            conn.commit()
            conn.close()

            with patch("app.storage.database.DB_PATH", old_path):
                from app.storage.database import _local, _qcache, get_db
                if hasattr(_local, "conn") and _local.conn is not None:
                    _local.conn.close()
                    _local.conn = None
                _qcache.invalidate()
                init_db()
                with get_db() as db_conn:
                    columns = {
                        row["name"]
                        for row in db_conn.execute("PRAGMA table_info(fund_master)").fetchall()
                    }
        finally:
            from app.storage.database import _local
            if hasattr(_local, "conn") and _local.conn is not None:
                _local.conn.close()
                _local.conn = None
            try:
                os.unlink(old_path)
            except FileNotFoundError:
                pass

        self.assertIn("data_version", columns)


class StorageAuthTest(unittest.TestCase):
    """验证 API 层未登录返回 401。"""

    def setUp(self):
        self.db_fd, self.db_path = tempfile.mkstemp(suffix=".db")
        with patch("app.storage.database.DB_PATH", self.db_path):
            from app.storage.database import _local
            _local.conn = None
            init_db()
            UserStore.seed_admin()
            self.user = UserStore.register("tester", "password", "Tester")
            self.assertIsNotNone(self.user)

    def tearDown(self):
        from app.storage.database import _local
        if hasattr(_local, "conn") and _local.conn is not None:
            try:
                _local.conn.close()
            except Exception:
                pass
            _local.conn = None
        os.close(self.db_fd)
        try:
            os.unlink(self.db_path)
        except FileNotFoundError:
            pass

    def test_api_unauthorized_returns_401(self):
        """未登录调用 API 应抛 401。"""
        from fastapi import HTTPException
        from app.api.storage import _require_user
        from unittest.mock import MagicMock

        request = MagicMock()
        request.headers.get.return_value = None  # no cookie, no auth header
        with self.assertRaises(HTTPException) as ctx:
            _require_user(request)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_api_session_from_cookie(self):
        """cookie 中有有效 token 时解析出用户。"""
        from app.api.storage import _get_current_user
        from unittest.mock import MagicMock

        with patch("app.storage.database.DB_PATH", self.db_path):
            token = UserStore.create_session(self.user["id"])

        request = MagicMock()
        request.headers.get.side_effect = lambda key, default=None: {
            "cookie": f"kimi_sid={token}",
        }.get(key, default)
        user = _get_current_user(request)
        self.assertIsNotNone(user)
        self.assertEqual(user["id"], self.user["id"])

    def test_api_session_from_authorization_header(self):
        """Authorization Bearer token 时解析出用户。"""
        from app.api.storage import _get_current_user
        from unittest.mock import MagicMock

        with patch("app.storage.database.DB_PATH", self.db_path):
            token = UserStore.create_session(self.user["id"])

        request = MagicMock()
        request.headers.get.side_effect = lambda key, default=None: {
            "authorization": f"Bearer {token}",
        }.get(key, default)
        user = _get_current_user(request)
        self.assertIsNotNone(user)
        self.assertEqual(user["id"], self.user["id"])


if __name__ == "__main__":
    unittest.main()
