"""
Storage Owner Isolation Tests — Phase 1 Step 6

验证: 已保存方案严格按用户隔离，旧无 owner 方案不泄漏。
"""
import json
import os
import tempfile
import unittest
from unittest.mock import patch

from app.storage.database import Database, UserStore, init_db


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
