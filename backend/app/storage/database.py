"""
SQLite Database Module — 数据持久化层
支持配置方案存储、调仓历史记录、用户偏好
"""
import sqlite3
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any, List

# Database file location
DB_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DB_PATH = DB_DIR / "fundtrader.db"

# Thread-local storage for connections
_local = threading.local()


def _get_connection() -> sqlite3.Connection:
    """Get thread-local database connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        _local.conn = sqlite3.connect(str(DB_PATH))
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")  # Better concurrency
        _local.conn.execute("PRAGMA foreign_keys=ON")
    return _local.conn


@contextmanager
def get_db():
    """Context manager for database transactions."""
    conn = _get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


class Database:
    """High-level database operations."""

    # ─── Initialization ───

    @staticmethod
    def init_tables():
        """Create tables if they don't exist."""
        with get_db() as conn:
            conn.executescript("""
                -- 配置方案表
                CREATE TABLE IF NOT EXISTS allocation_plans (
                    id TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    name TEXT NOT NULL DEFAULT '未命名方案',
                    description TEXT DEFAULT '',
                    request_json TEXT NOT NULL,
                    response_json TEXT NOT NULL,
                    risk_profile TEXT NOT NULL,
                    is_favorite INTEGER DEFAULT 0,
                    is_archived INTEGER DEFAULT 0
                );

                -- 调仓历史表
                CREATE TABLE IF NOT EXISTS rebalance_history (
                    id TEXT PRIMARY KEY,
                    executed_at TEXT NOT NULL,
                    plan_id TEXT,
                    risk_profile TEXT NOT NULL,
                    trigger_type TEXT NOT NULL,
                    actions_json TEXT NOT NULL,
                    total_turnover REAL DEFAULT 0,
                    estimated_cost REAL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'executed',
                    summary TEXT DEFAULT '',
                    notes TEXT DEFAULT '',
                    FOREIGN KEY (plan_id) REFERENCES allocation_plans(id) ON DELETE SET NULL
                );

                -- 用户偏好表
                CREATE TABLE IF NOT EXISTS user_preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- 索引
                CREATE INDEX IF NOT EXISTS idx_plans_created ON allocation_plans(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_plans_risk ON allocation_plans(risk_profile);
                CREATE INDEX IF NOT EXISTS idx_rebalance_date ON rebalance_history(executed_at DESC);
                CREATE INDEX IF NOT EXISTS idx_rebalance_plan ON rebalance_history(plan_id);
            """)

    # ─── Allocation Plans ───

    @staticmethod
    def save_plan(
        plan_id: str,
        name: str,
        request: Dict[str, Any],
        response: Dict[str, Any],
        risk_profile: str,
        description: str = "",
    ) -> str:
        """Save an allocation plan."""
        now = datetime.now().isoformat()
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO allocation_plans
                   (id, created_at, updated_at, name, description, request_json, response_json, risk_profile)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (plan_id, now, now, name, description,
                 json.dumps(request, ensure_ascii=False),
                 json.dumps(response, ensure_ascii=False),
                 risk_profile)
            )
        return plan_id

    @staticmethod
    def get_plan(plan_id: str) -> Optional[Dict[str, Any]]:
        """Get a single plan by ID."""
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM allocation_plans WHERE id = ?", (plan_id,)
            ).fetchone()
            if row:
                return Database._plan_row_to_dict(row)
        return None

    @staticmethod
    def list_plans(
        risk_profile: Optional[str] = None,
        favorite_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List allocation plans."""
        query = "SELECT * FROM allocation_plans WHERE is_archived = 0"
        params: List[Any] = []

        if risk_profile:
            query += " AND risk_profile = ?"
            params.append(risk_profile)
        if favorite_only:
            query += " AND is_favorite = 1"

        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with get_db() as conn:
            rows = conn.execute(query, params).fetchall()
            return [Database._plan_row_to_dict(row) for row in rows]

    @staticmethod
    def update_plan(
        plan_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        is_favorite: Optional[bool] = None,
        is_archived: Optional[bool] = None,
    ) -> bool:
        """Update plan metadata."""
        updates = []
        params: List[Any] = []

        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if is_favorite is not None:
            updates.append("is_favorite = ?")
            params.append(1 if is_favorite else 0)
        if is_archived is not None:
            updates.append("is_archived = ?")
            params.append(1 if is_archived else 0)

        if not updates:
            return False

        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(plan_id)

        with get_db() as conn:
            cursor = conn.execute(
                f"UPDATE allocation_plans SET {', '.join(updates)} WHERE id = ?",
                params
            )
            return cursor.rowcount > 0

    @staticmethod
    def delete_plan(plan_id: str) -> bool:
        """Delete a plan."""
        with get_db() as conn:
            cursor = conn.execute(
                "DELETE FROM allocation_plans WHERE id = ?", (plan_id,)
            )
            return cursor.rowcount > 0

    @staticmethod
    def count_plans(risk_profile: Optional[str] = None) -> int:
        """Count plans."""
        query = "SELECT COUNT(*) as cnt FROM allocation_plans WHERE is_archived = 0"
        params: List[Any] = []
        if risk_profile:
            query += " AND risk_profile = ?"
            params.append(risk_profile)
        with get_db() as conn:
            row = conn.execute(query, params).fetchone()
            return row["cnt"] if row else 0

    @staticmethod
    def _plan_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert plan row to dict."""
        return {
            "id": row["id"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "name": row["name"],
            "description": row["description"],
            "request": json.loads(row["request_json"]),
            "response": json.loads(row["response_json"]),
            "risk_profile": row["risk_profile"],
            "is_favorite": bool(row["is_favorite"]),
            "is_archived": bool(row["is_archived"]),
        }

    # ─── Rebalance History ───

    @staticmethod
    def add_rebalance_record(
        record_id: str,
        risk_profile: str,
        trigger_type: str,
        actions: List[Dict[str, Any]],
        total_turnover: float,
        estimated_cost: float,
        status: str = "executed",
        summary: str = "",
        notes: str = "",
        plan_id: Optional[str] = None,
        executed_at: Optional[str] = None,
    ) -> str:
        """Add a rebalance history record."""
        if executed_at is None:
            executed_at = datetime.now().strftime("%Y-%m-%d")
        with get_db() as conn:
            conn.execute(
                """INSERT INTO rebalance_history
                   (id, executed_at, plan_id, risk_profile, trigger_type,
                    actions_json, total_turnover, estimated_cost, status, summary, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (record_id, executed_at, plan_id, risk_profile, trigger_type,
                 json.dumps(actions, ensure_ascii=False),
                 total_turnover, estimated_cost, status, summary, notes)
            )
        return record_id

    @staticmethod
    def list_rebalance_history(
        plan_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """List rebalance history."""
        query = "SELECT * FROM rebalance_history WHERE 1=1"
        params: List[Any] = []

        if plan_id:
            query += " AND plan_id = ?"
            params.append(plan_id)
        if status:
            query += " AND status = ?"
            params.append(status)

        query += " ORDER BY executed_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with get_db() as conn:
            rows = conn.execute(query, params).fetchall()
            return [Database._rebalance_row_to_dict(row) for row in rows]

    @staticmethod
    def get_rebalance_stats() -> Dict[str, Any]:
        """Get rebalance statistics."""
        with get_db() as conn:
            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM rebalance_history"
            ).fetchone()["cnt"]
            executed = conn.execute(
                "SELECT COUNT(*) as cnt FROM rebalance_history WHERE status = 'executed'"
            ).fetchone()["cnt"]
            total_cost = conn.execute(
                "SELECT COALESCE(SUM(estimated_cost), 0) as total FROM rebalance_history WHERE status = 'executed'"
            ).fetchone()["total"]
            last_date = conn.execute(
                "SELECT MAX(executed_at) as last FROM rebalance_history"
            ).fetchone()["last"]
            return {
                "total_records": total,
                "executed_count": executed,
                "total_cost": round(total_cost, 2),
                "last_rebalance_date": last_date,
            }

    @staticmethod
    def _rebalance_row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
        """Convert rebalance row to dict."""
        return {
            "id": row["id"],
            "executed_at": row["executed_at"],
            "plan_id": row["plan_id"],
            "risk_profile": row["risk_profile"],
            "trigger_type": row["trigger_type"],
            "actions": json.loads(row["actions_json"]),
            "total_turnover": row["total_turnover"],
            "estimated_cost": row["estimated_cost"],
            "status": row["status"],
            "summary": row["summary"],
            "notes": row["notes"],
        }

    # ─── User Preferences ───

    @staticmethod
    def set_preference(key: str, value: Any) -> None:
        """Set a user preference."""
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO user_preferences (key, value, updated_at)
                   VALUES (?, ?, ?)""",
                (key, json.dumps(value, ensure_ascii=False), datetime.now().isoformat())
            )

    @staticmethod
    def get_preference(key: str, default: Any = None) -> Any:
        """Get a user preference."""
        with get_db() as conn:
            row = conn.execute(
                "SELECT value FROM user_preferences WHERE key = ?", (key,)
            ).fetchone()
            if row:
                return json.loads(row["value"])
        return default


# ─── Module-level initialization ───

def init_db():
    """Initialize database tables."""
    Database.init_tables()


def get_db_context():
    """Alias for get_db context manager."""
    return get_db()
