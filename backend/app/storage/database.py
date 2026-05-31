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
                -- 用户表
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    password_salt TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    email TEXT DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- 会话表
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

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

                -- 宏观数据历史表 (月频/季频经济指标缓存)
                CREATE TABLE IF NOT EXISTS macro_history (
                    indicator TEXT NOT NULL,
                    value REAL NOT NULL,
                    date TEXT NOT NULL,
                    source TEXT NOT NULL DEFAULT 'api',
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (indicator, date)
                );

                -- ETF日线价格缓存表 (回测加速, 仅存close)
                CREATE TABLE IF NOT EXISTS etf_daily_prices (
                    code TEXT NOT NULL,
                    trade_date TEXT NOT NULL,
                    close REAL NOT NULL,
                    source TEXT DEFAULT 'api',
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (code, trade_date)
                );

                -- 基金池元数据表 (替代硬编码_FUND_POOL)
                CREATE TABLE IF NOT EXISTS fund_pool (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    fund_type TEXT NOT NULL,
                    asset_class TEXT NOT NULL,
                    company TEXT DEFAULT '',
                    management_fee REAL DEFAULT 0.005,
                    custody_fee REAL DEFAULT 0.001,
                    aum REAL DEFAULT 10.0,
                    daily_turnover REAL DEFAULT 5000.0,
                    tracking_error REAL DEFAULT 0.02,
                    base_quality REAL DEFAULT 85.0,
                    is_active INTEGER DEFAULT 1
                );

                -- 基金NAV计算缓存表 (return_1y/sharpe_1y等)
                CREATE TABLE IF NOT EXISTS fund_nav_cache (
                    code TEXT NOT NULL,
                    metric TEXT NOT NULL,
                    value REAL NOT NULL,
                    data_points INTEGER,
                    computed_at TEXT NOT NULL,
                    PRIMARY KEY (code, metric)
                );

                -- 统计快照表 (rolling_stats/vol_snapshot/ic_decay)
                CREATE TABLE IF NOT EXISTS stats_snapshot (
                    snapshot_type TEXT PRIMARY KEY,
                    data_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                -- 市场体制历史表
                CREATE TABLE IF NOT EXISTS regime_history (
                    detected_at TEXT PRIMARY KEY,
                    regime TEXT NOT NULL,
                    label TEXT NOT NULL,
                    growth_score REAL DEFAULT 0,
                    inflation_score REAL DEFAULT 0,
                    confidence REAL DEFAULT 0,
                    source TEXT DEFAULT 'auto'
                );

                -- 索引
                CREATE INDEX IF NOT EXISTS idx_plans_created ON allocation_plans(created_at DESC);
                CREATE INDEX IF NOT EXISTS idx_plans_risk ON allocation_plans(risk_profile);
                CREATE INDEX IF NOT EXISTS idx_rebalance_date ON rebalance_history(executed_at DESC);
                CREATE INDEX IF NOT EXISTS idx_rebalance_plan ON rebalance_history(plan_id);
                CREATE INDEX IF NOT EXISTS idx_macro_indicator ON macro_history(indicator, date DESC);
                CREATE INDEX IF NOT EXISTS idx_etf_code_date ON etf_daily_prices(code, trade_date);
                CREATE INDEX IF NOT EXISTS idx_fund_nav_code ON fund_nav_cache(code);
                CREATE INDEX IF NOT EXISTS idx_regime_date ON regime_history(detected_at DESC);
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


# ─── Macro History Cache ───────────────────────────────────────────────────────

class MacroCache:
    """SQLite-backed cache for macroeconomic indicator time series.

    TTL-aware: daily indicators expire after 4h, monthly after 24h, quarterly after 7d.
    """

    # TTL in seconds by data frequency
    TTL = {
        "daily": 14400,      # 4 hours
        "monthly": 86400,    # 24 hours
        "quarterly": 604800, # 7 days
    }

    # Indicator frequency mapping
    FREQ = {
        "PMI制造业": "monthly", "GDP同比": "quarterly",
        "CPI同比": "monthly", "PPI同比": "monthly",
        "10Y国债收益率": "daily", "DR007": "daily",
        "社融增量": "monthly", "M2增速": "monthly",
        "融资余额变化": "daily", "北向资金净流入": "daily",
        "财政赤字率": "quarterly", "美联储利率": "monthly",
        "美元指数": "daily",
    }

    @staticmethod
    def save(indicator: str, value: float, date: str, source: str = "api"):
        """Save a macro indicator value. Uses INSERT OR REPLACE."""
        from datetime import datetime
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO macro_history
                   (indicator, value, date, source, fetched_at)
                   VALUES (?, ?, ?, ?, ?)""",
                (indicator, value, date, source, datetime.now().isoformat())
            )

    @staticmethod
    def save_batch(rows: list):
        """Save multiple indicators at once. rows: [(indicator, value, date, source), ...]"""
        from datetime import datetime
        now = datetime.now().isoformat()
        with get_db() as conn:
            conn.executemany(
                """INSERT OR REPLACE INTO macro_history
                   (indicator, value, date, source, fetched_at)
                   VALUES (?, ?, ?, ?, ?)""",
                [(r[0], r[1], r[2], r[3] if len(r) > 3 else "api", now) for r in rows]
            )

    @staticmethod
    def get(indicator: str) -> Optional[float]:
        """Get the latest cached value for an indicator. Returns None if expired or missing."""
        from datetime import datetime, timedelta
        freq = MacroCache.FREQ.get(indicator, "monthly")
        ttl = MacroCache.TTL.get(freq, 86400)
        cutoff = (datetime.now() - timedelta(seconds=ttl)).isoformat()

        with get_db() as conn:
            row = conn.execute(
                """SELECT value, date, source, fetched_at FROM macro_history
                   WHERE indicator = ? AND fetched_at > ?
                   ORDER BY date DESC LIMIT 1""",
                (indicator, cutoff)
            ).fetchone()
            if row:
                return row["value"]
        return None

    @staticmethod
    def get_all() -> dict:
        """Get all non-expired cached values. Returns {indicator: value}."""
        from datetime import datetime, timedelta
        with get_db() as conn:
            result = {}
            for indicator, freq in MacroCache.FREQ.items():
                ttl = MacroCache.TTL.get(freq, 86400)
                cutoff = (datetime.now() - timedelta(seconds=ttl)).isoformat()
                row = conn.execute(
                    """SELECT value FROM macro_history
                       WHERE indicator = ? AND fetched_at > ?
                       ORDER BY date DESC LIMIT 1""",
                    (indicator, cutoff)
                ).fetchone()
                if row:
                    result[indicator] = row["value"]
            return result

    @staticmethod
    def get_history(indicator: str, limit: int = 24) -> list:
        """Get historical time series for an indicator. Returns [(date, value, source), ...]"""
        with get_db() as conn:
            rows = conn.execute(
                """SELECT date, value, source FROM macro_history
                   WHERE indicator = ?
                   ORDER BY date DESC LIMIT ?""",
                (indicator, limit)
            ).fetchall()
            return [(r["date"], r["value"], r["source"]) for r in rows]


# ─── ETF Price Cache ──────────────────────────────────────────────────────────

class ETFPriceCache:
    """SQLite-backed cache for ETF daily close prices. Used by backtest engine."""

    @staticmethod
    def save_batch(code: str, prices: dict) -> None:
        """Save {date: close} for one ETF code. Uses INSERT OR IGNORE (idempotent)."""
        from datetime import datetime
        now = datetime.now().isoformat()
        with get_db() as conn:
            conn.executemany(
                """INSERT OR IGNORE INTO etf_daily_prices (code, trade_date, close, source, fetched_at)
                   VALUES (?, ?, ?, 'api', ?)""",
                [(code, date, close, now) for date, close in prices.items()]
            )

    @staticmethod
    def get_range(code: str, start: str, end: str) -> dict:
        """Get cached prices for date range. Returns {date: close}."""
        with get_db() as conn:
            rows = conn.execute(
                """SELECT trade_date, close FROM etf_daily_prices
                   WHERE code = ? AND trade_date >= ? AND trade_date <= ?
                   ORDER BY trade_date""",
                (code, start, end)
            ).fetchall()
            return {r["trade_date"]: r["close"] for r in rows}

    @staticmethod
    def get_latest_date(code: str) -> str | None:
        """Get the most recent cached date for an ETF."""
        with get_db() as conn:
            row = conn.execute(
                "SELECT MAX(trade_date) as d FROM etf_daily_prices WHERE code = ?", (code,)
            ).fetchone()
            return row["d"] if row else None


# ─── Fund Pool Cache ──────────────────────────────────────────────────────────

class FundPoolCache:
    """SQLite-backed fund pool. Seeds from hardcoded _FUND_POOL on first init."""

    @staticmethod
    def seed_from_dict(pool: dict) -> None:
        """One-time seed from hardcoded pool. Only inserts if table is empty."""
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) as c FROM fund_pool").fetchone()["c"]
            if count > 0:
                return
            now = __import__('datetime').datetime.now().isoformat()
            for code, p in pool.items():
                conn.execute(
                    """INSERT OR IGNORE INTO fund_pool
                       (code, name, fund_type, asset_class, company, management_fee, custody_fee,
                        aum, daily_turnover, tracking_error, base_quality)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (code, p.name, p.fund_type, p.asset_class, p.company,
                     p.management_fee, p.custody_fee, p.aum, p.daily_turnover,
                     p.tracking_error, p.base_quality)
                )

    @staticmethod
    def get_all() -> list:
        """Get all active fund pool entries."""
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM fund_pool WHERE is_active = 1"
            ).fetchall()
            return [dict(r) for r in rows]


# ─── Fund NAV Cache ───────────────────────────────────────────────────────────

class FundNAVCache:
    """SQLite-backed cache for computed fund metrics (return_1y, sharpe_1y, etc.)."""
    TTL_SECONDS = 14400  # 4 hours

    @staticmethod
    def get(code: str, metric: str) -> float | None:
        """Get cached metric value if not expired."""
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(seconds=FundNAVCache.TTL_SECONDS)).isoformat()
        with get_db() as conn:
            row = conn.execute(
                """SELECT value FROM fund_nav_cache
                   WHERE code = ? AND metric = ? AND computed_at > ?""",
                (code, metric, cutoff)
            ).fetchone()
            return row["value"] if row else None

    @staticmethod
    def save(code: str, metrics: dict) -> None:
        """Save multiple computed metrics for one fund."""
        from datetime import datetime
        now = datetime.now().isoformat()
        with get_db() as conn:
            conn.executemany(
                """INSERT OR REPLACE INTO fund_nav_cache (code, metric, value, data_points, computed_at)
                   VALUES (?, ?, ?, ?, ?)""",
                [(code, k, v, metrics.get("data_points"), now) for k, v in metrics.items()
                 if k != "data_points"]
            )

    @staticmethod
    def clear_expired() -> None:
        """Remove entries older than TTL."""
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(seconds=FundNAVCache.TTL_SECONDS)).isoformat()
        with get_db() as conn:
            conn.execute("DELETE FROM fund_nav_cache WHERE computed_at < ?", (cutoff,))


# ─── Stats Snapshot Cache ─────────────────────────────────────────────────────

class StatsSnapshotCache:
    """SQLite-backed cache for rolling stats / vol snapshots / IC decay."""

    @staticmethod
    def save(snapshot_type: str, data: dict) -> None:
        """Save a stats snapshot as JSON."""
        import json
        from datetime import datetime
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO stats_snapshot (snapshot_type, data_json, created_at)
                   VALUES (?, ?, ?)""",
                (snapshot_type, json.dumps(data, ensure_ascii=False), datetime.now().isoformat())
            )

    @staticmethod
    def get(snapshot_type: str) -> dict | None:
        """Load a stats snapshot."""
        import json
        with get_db() as conn:
            row = conn.execute(
                "SELECT data_json FROM stats_snapshot WHERE snapshot_type = ?", (snapshot_type,)
            ).fetchone()
            return json.loads(row["data_json"]) if row else None


# ─── Regime History ───────────────────────────────────────────────────────────

class RegimeHistoryCache:
    """SQLite-backed log of market regime changes."""

    @staticmethod
    def log(regime: str, label: str, growth_score: float, inflation_score: float,
            confidence: float, source: str = "auto") -> None:
        """Record a regime detection event."""
        from datetime import datetime
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO regime_history
                   (detected_at, regime, label, growth_score, inflation_score, confidence, source)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (datetime.now().isoformat(), regime, label, growth_score, inflation_score,
                 confidence, source)
            )

    @staticmethod
    def get_recent(limit: int = 10) -> list:
        """Get most recent regime history entries."""
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM regime_history ORDER BY detected_at DESC LIMIT ?", (limit,)
            ).fetchall()
            return [dict(r) for r in rows]


# ─── User Store ───
    @staticmethod
    def cleanup_expired_sessions() -> int:
        """Delete expired sessions. Returns count of deleted rows."""
        from datetime import datetime
        with get_db() as conn:
            cur = conn.execute("DELETE FROM sessions WHERE expires_at < ?", (datetime.now().isoformat(),))
            return cur.rowcount


class UserStore:
    """SQLite-backed user & session management. Replaces JSON file store."""

    @staticmethod
    def seed_admin() -> None:
        """Create default admin user if no users exist."""
        import hashlib, os, uuid
        from datetime import datetime
        with get_db() as conn:
            count = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
            if count > 0:
                return
            salt = os.urandom(16)
            pw = hashlib.pbkdf2_hmac("sha256", b"admin123", salt, 120000)
            now = datetime.now().isoformat()
            conn.execute(
                """INSERT INTO users (id, username, password_hash, password_salt, display_name, role, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (str(uuid.uuid4()), "admin", pw.hex(), salt.hex(), "管理员", "admin", now, now)
            )
            print("[UserStore] Seeded admin user")

    @staticmethod
    def register(username: str, password: str, display_name: str = "") -> dict | None:
        """Create a new user. Returns user dict or None if username taken."""
        import hashlib, os, uuid
        from datetime import datetime
        uid = str(uuid.uuid4())
        salt = os.urandom(16)
        pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120000)
        now = datetime.now().isoformat()
        try:
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO users (id, username, password_hash, password_salt, display_name, role, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 'user', ?, ?)""",
                    (uid, username, pw_hash.hex(), salt.hex(), display_name or username, now, now)
                )
            return {"id": uid, "username": username, "displayName": display_name or username, "role": "user"}
        except Exception:
            return None  # Username already taken

    @staticmethod
    def login(username: str, password: str) -> dict | None:
        """Validate credentials. Returns user dict or None."""
        import hashlib, hmac
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE username = ?", (username,)
            ).fetchone()
            if not row:
                return None
            salt = bytes.fromhex(row["password_salt"])
            expected = bytes.fromhex(row["password_hash"])
            actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120000)
            if not hmac.compare_digest(expected, actual):
                return None
            return {"id": row["id"], "username": row["username"],
                    "displayName": row["display_name"], "role": row["role"]}

    @staticmethod
    def get_by_id(user_id: str) -> dict | None:
        """Get user by ID."""
        with get_db() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not row:
                return None
            return {"id": row["id"], "username": row["username"],
                    "displayName": row["display_name"], "role": row["role"]}

    @staticmethod
    def create_session(user_id: str) -> str:
        """Create a session, return token (plaintext)."""
        import hashlib, os, secrets
        from datetime import datetime, timedelta
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = datetime.now()
        expires = now + timedelta(days=30)
        with get_db() as conn:
            conn.execute(
                "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
                (token_hash, user_id, now.isoformat(), expires.isoformat())
            )
        return token

    @staticmethod
    def get_user_by_session(token: str) -> dict | None:
        """Look up user from session token. Returns user dict or None if invalid/expired."""
        import hashlib
        from datetime import datetime
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with get_db() as conn:
            row = conn.execute(
                """SELECT u.id, u.username, u.display_name, u.role
                   FROM sessions s JOIN users u ON s.user_id = u.id
                   WHERE s.token_hash = ? AND s.expires_at > ?""",
                (token_hash, datetime.now().isoformat())
            ).fetchone()
            if not row:
                return None
            return {"id": row["id"], "username": row["username"],
                    "displayName": row["display_name"], "role": row["role"]}

    @staticmethod
    def delete_session(token: str) -> None:
        """Delete a session (logout)."""
        import hashlib
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with get_db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
