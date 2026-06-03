"""
SQLite Database Module — 数据持久化层
支持配置方案存储、调仓历史记录、用户偏好
"""
import json
import logging
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Database file location
DB_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DB_PATH = DB_DIR / "fundtrader.db"

# Thread-local storage for connections
_local = threading.local()


def _get_connection() -> sqlite3.Connection:
    """Get thread-local database connection with performance-optimized PRAGMAs."""
    if not hasattr(_local, "conn") or _local.conn is None:
        DB_DIR.mkdir(parents=True, exist_ok=True)
        _local.conn = sqlite3.connect(str(DB_PATH))
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA foreign_keys=ON")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
        _local.conn.execute("PRAGMA cache_size=-64000")
        _local.conn.execute("PRAGMA mmap_size=134217728")
        _local.conn.execute("PRAGMA temp_store=MEMORY")
        _local.conn.execute("PRAGMA wal_autocheckpoint=1000")
    return _local.conn


class _QueryCache:
    """Lightweight in-process TTL cache for hot SQLite queries.

    Avoids repeated 3-table JOINs on list_snapshots / get_snapshot when the
    underlying data hasn't changed.  Cache is invalidated on any write
    operation that mutates fund_master / fund_quote_snapshot /
    fund_metrics_snapshot.
    """

    _instance = None
    _instance_lock = threading.Lock()

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()
        self._invalidation_key = "v0"
        self._max_entries = 2000

    @classmethod
    def get_instance(cls) -> "_QueryCache":
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def get(self, key: str, ttl: float) -> Any | None:
        with self._lock:
            entry = self._cache.get(key)
            if entry is None:
                return None
            expires_at, inv_key, value = entry
            if inv_key != self._invalidation_key or time.time() > expires_at:
                del self._cache[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: float) -> None:
        with self._lock:
            if len(self._cache) >= self._max_entries:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
            self._cache[key] = (time.time() + ttl, self._invalidation_key, value)

    def invalidate(self) -> None:
        with self._lock:
            self._invalidation_key = f"v{time.time()}"
            self._cache.clear()

    def invalidate_prefix(self, prefix: str) -> None:
        with self._lock:
            keys_to_delete = [k for k in self._cache if k.startswith(prefix)]
            for k in keys_to_delete:
                del self._cache[k]


_qcache = _QueryCache.get_instance()


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
                    email_verified INTEGER DEFAULT 0,
                    avatar_url TEXT DEFAULT '',
                    role TEXT NOT NULL DEFAULT 'user',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- 邮箱验证令牌表
                CREATE TABLE IF NOT EXISTS email_tokens (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    email TEXT NOT NULL,
                    token_type TEXT NOT NULL DEFAULT 'verify',
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                );

                -- 密码重置令牌表
                CREATE TABLE IF NOT EXISTS password_reset_tokens (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    used INTEGER DEFAULT 0,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

                -- 基金快照表（每个交易日收盘后批量更新）
                CREATE TABLE IF NOT EXISTS fund_snapshot (
                    code TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    type TEXT NOT NULL DEFAULT '',
                    nav REAL DEFAULT 0,
                    day_growth REAL DEFAULT 0,
                    near_1m REAL DEFAULT 0,
                    near_3m REAL DEFAULT 0,
                    near_6m REAL DEFAULT 0,
                    near_1y REAL DEFAULT 0,
                    near_3y REAL DEFAULT 0,
                    ytd REAL DEFAULT 0,
                    tags_json TEXT DEFAULT '[]',
                    company TEXT DEFAULT '',
                    updated_at TEXT NOT NULL
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
                CREATE INDEX IF NOT EXISTS idx_fund_snapshot_type ON fund_snapshot(type);
                CREATE INDEX IF NOT EXISTS idx_fund_snapshot_updated ON fund_snapshot(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_fund_snapshot_company ON fund_snapshot(company);
                CREATE INDEX IF NOT EXISTS idx_fund_master_type_active ON fund_master(fund_type, is_active);
                CREATE INDEX IF NOT EXISTS idx_fund_metrics_code ON fund_metrics_snapshot(code);
                CREATE INDEX IF NOT EXISTS idx_fund_holdings_code ON fund_holdings_snapshot(code);
                CREATE INDEX IF NOT EXISTS idx_external_api_created ON external_api_call_log(created_at);
            """)

    # ─── Allocation Plans ───

    @staticmethod
    def save_plan(
        plan_id: str,
        name: str,
        request: dict[str, Any],
        response: dict[str, Any],
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
    def get_plan(plan_id: str) -> dict[str, Any] | None:
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
        risk_profile: str | None = None,
        favorite_only: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """List allocation plans."""
        query = "SELECT * FROM allocation_plans WHERE is_archived = 0"
        params: list[Any] = []

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
        name: str | None = None,
        description: str | None = None,
        is_favorite: bool | None = None,
        is_archived: bool | None = None,
    ) -> bool:
        """Update plan metadata."""
        updates = []
        params: list[Any] = []

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
    def count_plans(risk_profile: str | None = None) -> int:
        """Count plans."""
        query = "SELECT COUNT(*) as cnt FROM allocation_plans WHERE is_archived = 0"
        params: list[Any] = []
        if risk_profile:
            query += " AND risk_profile = ?"
            params.append(risk_profile)
        with get_db() as conn:
            row = conn.execute(query, params).fetchone()
            return row["cnt"] if row else 0

    @staticmethod
    def _plan_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
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
        actions: list[dict[str, Any]],
        total_turnover: float,
        estimated_cost: float,
        status: str = "executed",
        summary: str = "",
        notes: str = "",
        plan_id: str | None = None,
        executed_at: str | None = None,
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
        plan_id: str | None = None,
        status: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        """List rebalance history."""
        query = "SELECT * FROM rebalance_history WHERE 1=1"
        params: list[Any] = []

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
    def get_rebalance_stats() -> dict[str, Any]:
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
    def _rebalance_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
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
    _init_fund_data_center_tables()
    FundDataStore.bootstrap_from_legacy()


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
    def get(indicator: str) -> float | None:
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
        _qcache.invalidate_prefix(f"snapshot:{code}")
        _qcache.invalidate_prefix("list:")

    @staticmethod
    def clear_expired() -> None:
        """Remove entries older than TTL."""
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(seconds=FundNAVCache.TTL_SECONDS)).isoformat()
        with get_db() as conn:
            conn.execute("DELETE FROM fund_nav_cache WHERE computed_at < ?", (cutoff,))


# ─── Stats Snapshot Cache ─────────────────────────────────────────────────────

class StatsSnapshotCache:
    """SQLite-backed cache for rolling stats / vol snapshots / IC decay.

    TTL-aware: stats snapshots expire after 24 hours by default.
    """

    TTL_SECONDS = 86400  # 24 hours

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
        """Load a stats snapshot if not expired."""
        import json
        from datetime import datetime, timedelta
        cutoff = (datetime.now() - timedelta(seconds=StatsSnapshotCache.TTL_SECONDS)).isoformat()
        with get_db() as conn:
            row = conn.execute(
                """SELECT data_json, created_at FROM stats_snapshot
                   WHERE snapshot_type = ? AND created_at > ?""",
                (snapshot_type, cutoff)
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
        import hashlib
        import uuid
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
            logger.info("[UserStore] Seeded admin user")

    @staticmethod
    def register(username: str, password: str, display_name: str = "", email: str = "") -> dict | None:
        """Create a new user. Returns user dict or None if username taken."""
        import hashlib
        import uuid
        from datetime import datetime
        uid = str(uuid.uuid4())
        salt = os.urandom(16)
        pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 120000)
        now = datetime.now().isoformat()
        try:
            with get_db() as conn:
                conn.execute(
                    """INSERT INTO users (id, username, password_hash, password_salt, display_name, email, role, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, 'user', ?, ?)""",
                    (uid, username, pw_hash.hex(), salt.hex(), display_name or username, email, now, now)
                )
            return {"id": uid, "username": username, "displayName": display_name or username, "email": email, "role": "user"}
        except sqlite3.IntegrityError:
            logger.warning(f"User registration failed: username '{username}' already exists")
            return None

    @staticmethod
    def login(username: str, password: str) -> dict | None:
        """Validate credentials. Returns user dict or None."""
        import hashlib
        import hmac
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
        import hashlib
        import secrets
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

    @staticmethod
    def create_email_token(user_id: str, email: str, token_type: str = "verify") -> None:
        """Create an email verification token and send the email."""
        import hashlib
        import secrets
        from datetime import datetime, timedelta
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        now = datetime.now()
        expires = now + timedelta(hours=1)
        with get_db() as conn:
            conn.execute(
                """INSERT INTO email_tokens (token_hash, user_id, email, token_type, created_at, expires_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (token_hash, user_id, email, token_type, now.isoformat(), expires.isoformat())
            )
        # Send email async
        try:
            from app.api.email_util import send_verification_email
            send_verification_email(email, user_id[:8], token)
        except Exception:
            logger.exception("Failed to send verification email")

    @staticmethod
    def verify_email_token(token: str) -> dict | None:
        """Validate email verification token. Returns user dict or None."""
        import hashlib
        from datetime import datetime
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with get_db() as conn:
            row = conn.execute(
                """SELECT user_id, email FROM email_tokens
                   WHERE token_hash = ? AND expires_at > ? AND used = 0""",
                (token_hash, datetime.now().isoformat())
            ).fetchone()
            if not row:
                return None
            conn.execute("UPDATE email_tokens SET used = 1 WHERE token_hash = ?", (token_hash,))
            conn.execute("UPDATE users SET email_verified = 1, email = ? WHERE id = ?",
                         (row["email"], row["user_id"]))
            return UserStore.get_by_id(row["user_id"])

    @staticmethod
    def reset_password_send(username: str, email: str) -> bool:
        """Validate user+email match, generate new password, send via email. Returns bool."""
        import hashlib
        import secrets
        from datetime import datetime
        with get_db() as conn:
            row = conn.execute(
                "SELECT id, email FROM users WHERE username = ? AND email = ?", (username, email)
            ).fetchone()
            if not row:
                return False
            # Generate new random password
            new_pw = secrets.token_urlsafe(8)[:12]
            salt = os.urandom(16)
            pw_hash = hashlib.pbkdf2_hmac("sha256", new_pw.encode(), salt, 120000)
            conn.execute(
                "UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?",
                (pw_hash.hex(), salt.hex(), datetime.now().isoformat(), row["id"])
            )
            # Invalidate all sessions
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        try:
            from app.api.email_util import send_password_reset_email
            send_password_reset_email(email, username, new_pw)
        except Exception:
            logger.exception("Failed to send password reset email")
        return True

    @staticmethod
    def update_profile(user_id: str, display_name: str = "", email: str = "", avatar_url: str = "") -> None:
        """Update user profile fields."""
        from datetime import datetime
        updates = []
        params = []
        if display_name:
            updates.append("display_name = ?")
            params.append(display_name)
        if email:
            updates.append("email = ?")
            params.append(email)
        if avatar_url:
            updates.append("avatar_url = ?")
            params.append(avatar_url)
        if not updates:
            return
        updates.append("updated_at = ?")
        params.append(datetime.now().isoformat())
        params.append(user_id)
        with get_db() as conn:
            conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)


# ─── Fund Snapshot Cache ─────────────────────────────────────────────────────

class FundSnapshotCache:
    """SQLite-backed fund data snapshot. Updated once per trading day."""

    @staticmethod
    def save_batch(rows: list) -> None:
        """Save fund snapshots. rows: [(code, name, type, nav, day_growth, near_1m, near_3m, near_6m, near_1y, near_3y, ytd, tags_json, company, updated_at), ...]"""
        with get_db() as conn:
            conn.executemany(
                """INSERT OR REPLACE INTO fund_snapshot
                   (code, name, type, nav, day_growth, near_1m, near_3m, near_6m, near_1y, near_3y, ytd, tags_json, company, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                rows
            )
        _qcache.invalidate()

    @staticmethod
    def get_all() -> list:
        """Get all cached fund snapshots."""
        with get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM fund_snapshot ORDER BY code"
            ).fetchall()
            return [dict(r) for r in rows]

    @staticmethod
    def get_codes() -> set:
        """Get all cached fund codes."""
        with get_db() as conn:
            rows = conn.execute("SELECT code FROM fund_snapshot").fetchall()
            return {r["code"] for r in rows}

    @staticmethod
    def get_last_update() -> str | None:
        """Get the timestamp of the most recent snapshot update."""
        with get_db() as conn:
            row = conn.execute("SELECT MAX(updated_at) as t FROM fund_snapshot").fetchone()
            return row["t"] if row else None


def _init_fund_data_center_tables() -> None:
    """Create the unified fund data center tables.

    These tables are additive. They intentionally do not remove or rewrite the
    legacy fund_snapshot/fund_pool/fund_nav_cache tables so the rollout can be
    deployed incrementally.
    """
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS fund_master (
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
            );

            CREATE TABLE IF NOT EXISTS fund_quote_snapshot (
                code TEXT PRIMARY KEY,
                nav REAL,
                accum_nav REAL,
                nav_date TEXT DEFAULT '',
                day_growth REAL,
                near_1m REAL,
                near_3m REAL,
                near_6m REAL,
                near_1y REAL,
                near_3y REAL,
                ytd REAL,
                source TEXT DEFAULT 'snapshot',
                data_quality TEXT DEFAULT 'unknown',
                stale_level TEXT DEFAULT 'unknown',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (code) REFERENCES fund_master(code) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fund_nav_history (
                code TEXT NOT NULL,
                nav_date TEXT NOT NULL,
                nav REAL NOT NULL,
                accum_nav REAL,
                day_growth REAL,
                source TEXT DEFAULT 'api',
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (code, nav_date)
            );

            CREATE TABLE IF NOT EXISTS fund_metrics_snapshot (
                code TEXT PRIMARY KEY,
                sharpe_ratio REAL,
                max_drawdown REAL,
                volatility REAL,
                annualized_return REAL,
                score REAL,
                fee_manage REAL,
                fee_custody REAL,
                total_scale REAL,
                nav_points INTEGER DEFAULT 0,
                source TEXT DEFAULT 'snapshot',
                data_quality TEXT DEFAULT 'unknown',
                updated_at TEXT NOT NULL,
                FOREIGN KEY (code) REFERENCES fund_master(code) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fund_holdings_snapshot (
                code TEXT NOT NULL,
                report_date TEXT NOT NULL,
                holdings_json TEXT NOT NULL,
                asset_allocation_json TEXT DEFAULT '[]',
                source TEXT DEFAULT 'snapshot',
                data_quality TEXT DEFAULT 'unknown',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (code, report_date)
            );

            CREATE TABLE IF NOT EXISTS fund_category_metrics_snapshot (
                category TEXT NOT NULL,
                as_of_date TEXT NOT NULL,
                window_days INTEGER NOT NULL DEFAULT 365,
                avg_annual_return_eq REAL,
                avg_max_drawdown_eq REAL,
                avg_sharpe_eq REAL,
                sample_count INTEGER NOT NULL DEFAULT 0,
                total_count INTEGER NOT NULL DEFAULT 0,
                coverage_ratio REAL NOT NULL DEFAULT 0,
                risk_free_rate REAL NOT NULL DEFAULT 0.02,
                calc_version TEXT NOT NULL DEFAULT 'v1.0',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (category, as_of_date, window_days)
            );

            CREATE TABLE IF NOT EXISTS fund_detail_quarterly_snapshot (
                code TEXT NOT NULL,
                report_date TEXT NOT NULL,
                holder_structure_json TEXT DEFAULT '[]',
                bond_allocation_json TEXT DEFAULT '[]',
                bond_holdings_json TEXT DEFAULT '[]',
                total_scale REAL,
                turnover_rate REAL,
                source TEXT DEFAULT 'snapshot',
                data_quality TEXT DEFAULT 'unknown',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (code, report_date)
            );

            CREATE TABLE IF NOT EXISTS fund_benchmark_nav_history (
                benchmark_code TEXT NOT NULL,
                nav_date TEXT NOT NULL,
                nav REAL NOT NULL,
                source TEXT DEFAULT 'api',
                fetched_at TEXT NOT NULL,
                PRIMARY KEY (benchmark_code, nav_date)
            );

            CREATE TABLE IF NOT EXISTS fund_manager_history_snapshot (
                code TEXT NOT NULL,
                manager_name TEXT NOT NULL,
                start_date TEXT DEFAULT '',
                end_date TEXT DEFAULT '',
                total_return REAL,
                annualized_return REAL,
                rank_json TEXT DEFAULT '',
                source TEXT DEFAULT 'snapshot',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (code, manager_name, start_date)
            );

            CREATE TABLE IF NOT EXISTS fund_report_snapshot (
                code TEXT NOT NULL,
                report_date TEXT NOT NULL,
                report_type TEXT DEFAULT '',
                report_text TEXT NOT NULL,
                source TEXT DEFAULT 'snapshot',
                updated_at TEXT NOT NULL,
                PRIMARY KEY (code, report_date, report_type)
            );

            CREATE TABLE IF NOT EXISTS fund_drawdown_series (
                code TEXT NOT NULL,
                nav_date TEXT NOT NULL,
                window_days INTEGER NOT NULL DEFAULT 365,
                drawdown REAL NOT NULL,
                peak_nav REAL,
                current_nav REAL,
                source TEXT DEFAULT 'compute',
                computed_at TEXT NOT NULL,
                PRIMARY KEY (code, nav_date, window_days),
                FOREIGN KEY (code) REFERENCES fund_master(code) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS fund_data_job (
                id TEXT PRIMARY KEY,
                job_type TEXT NOT NULL,
                code TEXT DEFAULT '',
                priority INTEGER DEFAULT 5,
                status TEXT NOT NULL DEFAULT 'pending',
                payload_json TEXT DEFAULT '{}',
                error TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT DEFAULT '',
                finished_at TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS external_api_call_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                code TEXT DEFAULT '',
                cache_key TEXT DEFAULT '',
                duration_ms INTEGER DEFAULT 0,
                success INTEGER NOT NULL,
                error TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_fund_master_pool ON fund_master(is_xinjihui, is_preferred, is_active);
            CREATE INDEX IF NOT EXISTS idx_fund_master_type ON fund_master(fund_type);
            CREATE INDEX IF NOT EXISTS idx_fund_quote_updated ON fund_quote_snapshot(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_fund_quote_quality ON fund_quote_snapshot(data_quality, stale_level);
            CREATE INDEX IF NOT EXISTS idx_fund_nav_history_code_date ON fund_nav_history(code, nav_date);
            CREATE INDEX IF NOT EXISTS idx_fund_data_job_status ON fund_data_job(status, priority, created_at);
            CREATE INDEX IF NOT EXISTS idx_fund_drawdown_code_window ON fund_drawdown_series(code, window_days, nav_date);
            CREATE INDEX IF NOT EXISTS idx_external_api_call_log_source ON external_api_call_log(source, created_at);
            CREATE INDEX IF NOT EXISTS idx_category_metrics_asof ON fund_category_metrics_snapshot(as_of_date, window_days);
            CREATE INDEX IF NOT EXISTS idx_fund_detail_quarterly_code_date ON fund_detail_quarterly_snapshot(code, report_date);
            CREATE INDEX IF NOT EXISTS idx_fund_benchmark_nav_code_date ON fund_benchmark_nav_history(benchmark_code, nav_date);
            CREATE INDEX IF NOT EXISTS idx_manager_history_code ON fund_manager_history_snapshot(code);
            CREATE INDEX IF NOT EXISTS idx_fund_report_code_date ON fund_report_snapshot(code, report_date);
        """)


def _fund_tags(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if item]
    if isinstance(value, str) and value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return [str(item) for item in parsed if item]
        except json.JSONDecodeError:
            return [value]
    return []


def _stale_level(updated_at: str | None) -> str:
    if not updated_at:
        return "missing"
    try:
        age_days = (datetime.now() - datetime.fromisoformat(updated_at[:19])).days
    except (ValueError, TypeError):
        return "unknown"
    if age_days <= 1:
        return "fresh"
    if age_days <= 7:
        return "stale"
    return "very_stale"


class FundDataStore:
    """SQLite data-center facade for fund master, quotes, metrics, jobs and logs."""

    @staticmethod
    def bootstrap_from_legacy() -> None:
        """Idempotently seed new tables from the legacy pool and fund_snapshot."""
        now = datetime.now().isoformat()
        try:
            from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST
        except ImportError:
            logger.warning("GUOYUAN_FUND_LIST not found, using empty list")
            GUOYUAN_FUND_LIST = []

        with get_db() as conn:
            for fund in GUOYUAN_FUND_LIST:
                code = str(fund.get("code", "")).strip()
                if not code:
                    continue
                tags = _fund_tags(fund.get("tags"))
                if not tags:
                    tags = ["xinjihui"]
                conn.execute(
                    """INSERT INTO fund_master
                       (code, name, fund_type, company, tags_json, is_xinjihui, is_preferred,
                        is_active, data_quality, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, 1, 1, 1, 'seeded', ?, ?)
                       ON CONFLICT(code) DO UPDATE SET
                         name = COALESCE(NULLIF(excluded.name, ''), fund_master.name),
                         fund_type = COALESCE(NULLIF(excluded.fund_type, ''), fund_master.fund_type),
                         tags_json = excluded.tags_json,
                         is_xinjihui = 1,
                         is_preferred = 1,
                         is_active = 1,
                         updated_at = excluded.updated_at""",
                    (
                        code,
                        str(fund.get("name") or code),
                        str(fund.get("type") or fund.get("fund_type") or ""),
                        str(fund.get("company") or ""),
                        json.dumps(tags, ensure_ascii=False),
                        now,
                        now,
                    ),
                )

            legacy_rows = conn.execute("SELECT * FROM fund_snapshot").fetchall()
            for row in legacy_rows:
                tags = _fund_tags(row["tags_json"])
                tags_json = json.dumps(tags, ensure_ascii=False)
                updated_at = row["updated_at"] or now
                conn.execute(
                    """INSERT INTO fund_master
                       (code, name, fund_type, company, tags_json, is_xinjihui, is_preferred,
                        is_active, data_quality, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'snapshot', ?, ?)
                       ON CONFLICT(code) DO UPDATE SET
                         name = COALESCE(NULLIF(excluded.name, ''), fund_master.name),
                         fund_type = COALESCE(NULLIF(excluded.fund_type, ''), fund_master.fund_type),
                         company = COALESCE(NULLIF(excluded.company, ''), fund_master.company),
                         tags_json = CASE WHEN fund_master.tags_json = '[]' THEN excluded.tags_json ELSE fund_master.tags_json END,
                         data_quality = 'snapshot',
                         updated_at = excluded.updated_at""",
                    (
                        row["code"],
                        row["name"] or row["code"],
                        row["type"] or "",
                        row["company"] or "",
                        tags_json,
                        1 if tags else 0,
                        1 if tags else 0,
                        updated_at,
                        updated_at,
                    ),
                )
                FundDataStore._upsert_quote_row(conn, dict(row), source="legacy_fund_snapshot")

    @staticmethod
    def _upsert_quote_row(conn: sqlite3.Connection, row: dict[str, Any], source: str = "snapshot") -> None:
        updated_at = row.get("updated_at") or datetime.now().isoformat()
        has_nav = row.get("nav") not in (None, "", 0)
        quality = "ok" if has_nav else "partial"
        conn.execute(
            """INSERT INTO fund_quote_snapshot
               (code, nav, accum_nav, nav_date, day_growth, near_1m, near_3m, near_6m,
                near_1y, near_3y, ytd, source, data_quality, stale_level, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(code) DO UPDATE SET
                 nav = excluded.nav,
                 accum_nav = excluded.accum_nav,
                 nav_date = excluded.nav_date,
                 day_growth = excluded.day_growth,
                 near_1m = excluded.near_1m,
                 near_3m = excluded.near_3m,
                 near_6m = excluded.near_6m,
                 near_1y = excluded.near_1y,
                 near_3y = excluded.near_3y,
                 ytd = excluded.ytd,
                 source = excluded.source,
                 data_quality = excluded.data_quality,
                 stale_level = excluded.stale_level,
                 updated_at = excluded.updated_at""",
            (
                row.get("code"),
                row.get("nav"),
                row.get("accum_nav"),
                row.get("nav_date") or str(updated_at)[:10],
                row.get("day_growth"),
                row.get("near_1m"),
                row.get("near_3m"),
                row.get("near_6m"),
                row.get("near_1y"),
                row.get("near_3y"),
                row.get("ytd"),
                source,
                row.get("data_quality") or quality,
                _stale_level(updated_at),
                updated_at,
            ),
        )

    @staticmethod
    def save_quote_batch(rows: list[dict[str, Any]], source: str = "snapshot_refresh") -> None:
        now = datetime.now().isoformat()
        with get_db() as conn:
            for row in rows:
                code = str(row.get("code", "")).strip()
                if not code:
                    continue
                conn.execute(
                    """INSERT INTO fund_master
                       (code, name, fund_type, company, tags_json, is_xinjihui, is_preferred,
                        is_active, data_quality, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'snapshot', ?, ?)
                       ON CONFLICT(code) DO UPDATE SET
                         name = COALESCE(NULLIF(excluded.name, ''), fund_master.name),
                         fund_type = COALESCE(NULLIF(excluded.fund_type, ''), fund_master.fund_type),
                         company = COALESCE(NULLIF(excluded.company, ''), fund_master.company),
                         updated_at = excluded.updated_at""",
                    (
                        code,
                        str(row.get("name") or code),
                        str(row.get("type") or row.get("fund_type") or ""),
                        str(row.get("company") or ""),
                        json.dumps(_fund_tags(row.get("tags")) or ["xinjihui"], ensure_ascii=False),
                        1 if row.get("is_xinjihui", True) else 0,
                        1 if row.get("is_preferred", row.get("is_xinjihui", True)) else 0,
                        row.get("updated_at") or now,
                        row.get("updated_at") or now,
                    ),
                )
                FundDataStore._upsert_quote_row(conn, {**row, "updated_at": row.get("updated_at") or now}, source)
        _qcache.invalidate()

    @staticmethod
    def list_snapshots(
        category: str = "",
        keyword: str | None = None,
        xinjihui_only: bool = True,
        limit: int = 5000,
        offset: int = 0,
        sort_field: str = "ytd",
        sort_order: str = "desc",
    ) -> dict[str, Any]:
        cache_key = f"list:{category}:{keyword}:{xinjihui_only}:{limit}:{offset}:{sort_field}:{sort_order}"
        cached = _qcache.get(cache_key, 120)
        if cached is not None:
            return cached
        allowed_sort = {
            "nav", "day_growth", "near_1m", "near_3m", "near_6m",
            "near_1y", "near_3y", "ytd", "updated_at"
        }
        sort_sql = sort_field if sort_field in allowed_sort else "ytd"
        order_sql = "ASC" if sort_order.lower() == "asc" else "DESC"
        clauses = ["m.is_active = 1"]
        params: list[Any] = []
        if xinjihui_only:
            clauses.append("(m.is_xinjihui = 1 OR m.is_preferred = 1)")
        if category and category not in ("all", "全部", "鍏ㄩ儴"):
            clauses.append("m.fund_type = ?")
            params.append(category)
        if keyword:
            clauses.append("(m.code LIKE ? OR m.name LIKE ?)")
            like = f"%{keyword}%"
            params.extend([like, like])
        where = " AND ".join(clauses)
        limit = max(1, min(int(limit or 20), 5000))
        offset = max(0, int(offset or 0))
        with get_db() as conn:
            total = conn.execute(f"SELECT COUNT(*) as c FROM fund_master m WHERE {where}", params).fetchone()["c"]
            rows = conn.execute(
                f"""SELECT m.code, m.name, m.fund_type as type, m.company, m.tags_json,
                          m.is_xinjihui, m.is_preferred, m.data_quality as master_quality,
                          q.nav, q.accum_nav, q.nav_date, q.day_growth, q.near_1m, q.near_3m,
                          q.near_6m, q.near_1y, q.near_3y, q.ytd, q.updated_at,
                          q.data_quality, q.stale_level,
                          ms.sharpe_ratio, ms.max_drawdown, ms.volatility,
                          ms.annualized_return, ms.score, ms.fee_manage, ms.fee_custody,
                          ms.total_scale, ms.updated_at as metrics_updated_at
                   FROM fund_master m
                   LEFT JOIN fund_quote_snapshot q ON q.code = m.code
                   LEFT JOIN fund_metrics_snapshot ms ON ms.code = m.code
                   WHERE {where}
                   ORDER BY COALESCE(q.{sort_sql}, 0) {order_sql}, m.code
                   LIMIT ? OFFSET ?""",
                [*params, limit, offset],
            ).fetchall()
        result = {"total": total, "funds": [FundDataStore._row_to_fund(row) for row in rows]}
        _qcache.set(cache_key, result, 120)
        return result

    @staticmethod
    def get_snapshot(code: str) -> dict[str, Any] | None:
        cache_key = f"snapshot:{code}"
        cached = _qcache.get(cache_key, 120)
        if cached is not None:
            return cached
        with get_db() as conn:
            row = conn.execute(
                """SELECT m.code, m.name, m.fund_type as type, m.company, m.tags_json,
                          m.is_xinjihui, m.is_preferred, m.data_quality as master_quality,
                          q.nav, q.accum_nav, q.nav_date, q.day_growth, q.near_1m, q.near_3m,
                          q.near_6m, q.near_1y, q.near_3y, q.ytd, q.updated_at,
                          q.data_quality, q.stale_level,
                          ms.sharpe_ratio, ms.max_drawdown, ms.volatility,
                          ms.annualized_return, ms.score, ms.fee_manage, ms.fee_custody,
                          ms.total_scale, ms.updated_at as metrics_updated_at
                   FROM fund_master m
                   LEFT JOIN fund_quote_snapshot q ON q.code = m.code
                   LEFT JOIN fund_metrics_snapshot ms ON ms.code = m.code
                   WHERE m.code = ?""",
                (code,),
            ).fetchone()
            if row:
                result = FundDataStore._row_to_fund(row)
                # 补充净值历史（如有）
                nav_rows = conn.execute(
                    """SELECT nav_date, nav, accum_nav, day_growth
                       FROM fund_nav_history
                       WHERE code = ?
                       ORDER BY nav_date DESC
                       LIMIT 500""",
                    (code,),
                ).fetchall()
                if nav_rows:
                    result["nav_data"] = [
                        {
                            "date": str(r["nav_date"]),
                            "nav": float(r["nav"]) if r["nav"] is not None else None,
                            "accum_nav": float(r["accum_nav"]) if r["accum_nav"] is not None else None,
                            "day_growth": float(r["day_growth"]) if r["day_growth"] is not None else None,
                        }
                        for r in reversed(nav_rows)
                    ]
                _qcache.set(cache_key, result, 120)
                return result
            legacy = conn.execute("SELECT * FROM fund_snapshot WHERE code = ?", (code,)).fetchone()
            result = FundDataStore._legacy_row_to_fund(legacy) if legacy else None
            if result:
                _qcache.set(cache_key, result, 120)
            return result

    @staticmethod
    def _row_to_fund(row: sqlite3.Row) -> dict[str, Any]:
        tags = _fund_tags(row["tags_json"])
        return {
            "code": row["code"],
            "name": row["name"],
            "type": row["type"] or "",
            "company": row["company"] or "",
            "tags": tags,
            "is_xinjihui": bool(row["is_xinjihui"]),
            "is_preferred": bool(row["is_preferred"]),
            "nav": row["nav"] or 0,
            "accum_nav": row["accum_nav"],
            "nav_date": row["nav_date"] or "",
            "day_growth": row["day_growth"] or 0,
            "near_1m": row["near_1m"] or 0,
            "near_3m": row["near_3m"] or 0,
            "near_6m": row["near_6m"] or 0,
            "near_1y": row["near_1y"] or 0,
            "near_3y": row["near_3y"] or 0,
            "ytd": row["ytd"] or 0,
            "updated_at": row["updated_at"],
            "data_quality": row["data_quality"] or row["master_quality"] or "unknown",
            "stale_level": row["stale_level"] or _stale_level(row["updated_at"]),
            "sharpe_ratio": row["sharpe_ratio"],
            "max_drawdown": row["max_drawdown"],
            "annualized_return": row["annualized_return"],
            "volatility": row["volatility"],
            "score": row["score"],
            "feeManage": row["fee_manage"],
            "feeCustody": row["fee_custody"],
            "total_scale": row["total_scale"],
            "metrics_updated_at": row["metrics_updated_at"],
        }

    @staticmethod
    def _legacy_row_to_fund(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "code": row["code"],
            "name": row["name"],
            "type": row["type"] or "",
            "company": row["company"] or "",
            "tags": _fund_tags(row["tags_json"]),
            "is_xinjihui": True,
            "is_preferred": True,
            "nav": row["nav"] or 0,
            "day_growth": row["day_growth"] or 0,
            "near_1m": row["near_1m"] or 0,
            "near_3m": row["near_3m"] or 0,
            "near_6m": row["near_6m"] or 0,
            "near_1y": row["near_1y"] or 0,
            "near_3y": row["near_3y"] or 0,
            "ytd": row["ytd"] or 0,
            "updated_at": row["updated_at"],
            "data_quality": "legacy",
            "stale_level": _stale_level(row["updated_at"]),
        }

    @staticmethod
    def create_job(job_type: str, code: str = "", payload: dict[str, Any] | None = None, priority: int = 5) -> str:
        import uuid
        now = datetime.now().isoformat()
        job_id = str(uuid.uuid4())
        with get_db() as conn:
            existing = conn.execute(
                """SELECT id FROM fund_data_job
                   WHERE job_type = ? AND code = ? AND status IN ('pending', 'running')
                   ORDER BY created_at DESC LIMIT 1""",
                (job_type, code),
            ).fetchone()
            if existing:
                return existing["id"]
            conn.execute(
                """INSERT INTO fund_data_job
                   (id, job_type, code, priority, status, payload_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)""",
                (job_id, job_type, code, priority, json.dumps(payload or {}, ensure_ascii=False), now, now),
            )
        return job_id

    @staticmethod
    def log_external_api_call(
        source: str,
        endpoint: str,
        code: str = "",
        cache_key: str = "",
        duration_ms: int = 0,
        success: bool = True,
        error: str = "",
    ) -> None:
        with get_db() as conn:
            conn.execute(
                """INSERT INTO external_api_call_log
                   (source, endpoint, code, cache_key, duration_ms, success, error, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (source, endpoint, code, cache_key, duration_ms, 1 if success else 0, error[:500], datetime.now().isoformat()),
            )

    @staticmethod
    def save_nav_history_batch(code: str, nav_records: list[dict[str, Any]], source: str = "compute") -> int:
        """Upsert fund_nav_history rows for a single fund.

        nav_records: [{"date": "2024-01-02", "nav": 1.234, "acc_nav": 1.5, "day_growth": 0.5}, ...]
        Returns count of rows upserted.
        """
        if not nav_records:
            return 0
        now = datetime.now().isoformat()
        rows = []
        for r in nav_records:
            d = str(r.get("date") or r.get("nav_date") or "").strip()
            try:
                nav = float(r.get("nav", 0) or 0)
            except (TypeError, ValueError):
                continue
            if not d or nav <= 0:
                continue
            acc_nav = r.get("acc_nav") or r.get("accum_nav")
            day_growth = r.get("day_growth")
            try:
                acc_nav = float(acc_nav) if acc_nav is not None else None
            except (TypeError, ValueError):
                acc_nav = None
            try:
                day_growth = float(day_growth) if day_growth is not None else None
            except (TypeError, ValueError):
                day_growth = None
            rows.append((code, d, nav, acc_nav, day_growth, source, now))
        if not rows:
            return 0
        with get_db() as conn:
            conn.executemany(
                """INSERT INTO fund_nav_history
                   (code, nav_date, nav, accum_nav, day_growth, source, fetched_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(code, nav_date) DO UPDATE SET
                     nav = excluded.nav,
                     accum_nav = COALESCE(excluded.accum_nav, fund_nav_history.accum_nav),
                     day_growth = COALESCE(excluded.day_growth, fund_nav_history.day_growth),
                     source = excluded.source,
                     fetched_at = excluded.fetched_at""",
                rows,
            )
        return len(rows)

    @staticmethod
    def save_drawdown_series_batch(
        code: str,
        drawdown_records: list[dict[str, Any]],
        window_days: int = 365,
        source: str = "compute",
    ) -> int:
        """Upsert fund_drawdown_series rows for a single fund.

        drawdown_records: [{"date": "2024-01-02", "drawdown": -2.15, "peak_nav": 1.5, "current_nav": 1.467}, ...]
        Returns count of rows upserted.
        """
        if not drawdown_records:
            return 0
        now = datetime.now().isoformat()
        rows = []
        for r in drawdown_records:
            d = str(r.get("date") or r.get("nav_date") or "").strip()
            try:
                drawdown = float(r.get("drawdown", 0) or 0)
            except (TypeError, ValueError):
                continue
            if not d:
                continue
            peak_nav = r.get("peak_nav")
            current_nav = r.get("current_nav")
            try:
                peak_nav = float(peak_nav) if peak_nav is not None else None
            except (TypeError, ValueError):
                peak_nav = None
            try:
                current_nav = float(current_nav) if current_nav is not None else None
            except (TypeError, ValueError):
                current_nav = None
            rows.append((code, d, window_days, drawdown, peak_nav, current_nav, source, now))
        if not rows:
            return 0
        with get_db() as conn:
            conn.executemany(
                """INSERT INTO fund_drawdown_series
                   (code, nav_date, window_days, drawdown, peak_nav, current_nav, source, computed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(code, nav_date, window_days) DO UPDATE SET
                     drawdown = excluded.drawdown,
                     peak_nav = excluded.peak_nav,
                     current_nav = excluded.current_nav,
                     source = excluded.source,
                     computed_at = excluded.computed_at""",
                rows,
            )
        return len(rows)

    @staticmethod
    def save_metrics_batch(rows: list[dict[str, Any]], source: str = "compute") -> int:
        """Save computed metrics for multiple funds.

        rows: [{code, sharpe_ratio, max_drawdown, volatility, annualized_return,
               score, fee_manage, fee_custody, total_scale, nav_points}, ...]
        Returns count of upserted rows.
        """
        now = datetime.now().isoformat()
        with get_db() as conn:
            for r in rows:
                code = r.get("code", "")
                if not code:
                    continue
                conn.execute(
                    """INSERT INTO fund_metrics_snapshot
                       (code, sharpe_ratio, max_drawdown, volatility, annualized_return,
                        score, fee_manage, fee_custody, total_scale, nav_points,
                        source, data_quality, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(code) DO UPDATE SET
                         sharpe_ratio = excluded.sharpe_ratio,
                         max_drawdown = excluded.max_drawdown,
                         volatility = excluded.volatility,
                         annualized_return = excluded.annualized_return,
                         score = excluded.score,
                         fee_manage = excluded.fee_manage,
                         fee_custody = excluded.fee_custody,
                         total_scale = excluded.total_scale,
                         nav_points = excluded.nav_points,
                         source = excluded.source,
                         data_quality = excluded.data_quality,
                         updated_at = excluded.updated_at""",
                    (
                        code,
                        r.get("sharpe_ratio"),
                        r.get("max_drawdown"),
                        r.get("volatility"),
                        r.get("annualized_return"),
                        r.get("score"),
                        r.get("fee_manage"),
                        r.get("fee_custody"),
                        r.get("total_scale"),
                        r.get("nav_points", 0),
                        source,
                        r.get("data_quality", "computed"),
                        now,
                    ),
                )
        _qcache.invalidate()
        return len(rows)

    @staticmethod
    def save_category_metrics_snapshot(
        rows: list[dict[str, Any]],
        *,
        as_of_date: str,
        window_days: int = 365,
        risk_free_rate: float = 0.02,
        calc_version: str = "v1.0",
    ) -> int:
        now = datetime.now().isoformat()
        with get_db() as conn:
            for row in rows:
                conn.execute(
                    """INSERT INTO fund_category_metrics_snapshot
                       (category, as_of_date, window_days, avg_annual_return_eq, avg_max_drawdown_eq,
                        avg_sharpe_eq, sample_count, total_count, coverage_ratio, risk_free_rate,
                        calc_version, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                       ON CONFLICT(category, as_of_date, window_days) DO UPDATE SET
                         avg_annual_return_eq = excluded.avg_annual_return_eq,
                         avg_max_drawdown_eq = excluded.avg_max_drawdown_eq,
                         avg_sharpe_eq = excluded.avg_sharpe_eq,
                         sample_count = excluded.sample_count,
                         total_count = excluded.total_count,
                         coverage_ratio = excluded.coverage_ratio,
                         risk_free_rate = excluded.risk_free_rate,
                         calc_version = excluded.calc_version,
                         updated_at = excluded.updated_at""",
                    (
                        str(row.get("category") or "unknown"),
                        as_of_date,
                        int(window_days),
                        row.get("avg_annual_return_eq"),
                        row.get("avg_max_drawdown_eq"),
                        row.get("avg_sharpe_eq"),
                        int(row.get("sample_count") or 0),
                        int(row.get("total_count") or 0),
                        float(row.get("coverage_ratio") or 0),
                        float(risk_free_rate),
                        calc_version,
                        now,
                    ),
                )
        _qcache.invalidate()
        return len(rows)

    @staticmethod
    def get_latest_category_metrics(window_days: int = 365) -> dict[str, Any]:
        cache_key = f"category_metrics:{window_days}"
        cached = _qcache.get(cache_key, 300)
        if cached is not None:
            return cached
        with get_db() as conn:
            row = conn.execute(
                "SELECT MAX(as_of_date) as as_of_date FROM fund_category_metrics_snapshot WHERE window_days = ?",
                (int(window_days),),
            ).fetchone()
            as_of_date = row["as_of_date"] if row else None
            if not as_of_date:
                result = {"as_of_date": None, "window_days": int(window_days), "rows": []}
                _qcache.set(cache_key, result, 120)
                return result
            rows = conn.execute(
                """SELECT category, as_of_date, window_days, avg_annual_return_eq, avg_max_drawdown_eq,
                          avg_sharpe_eq, sample_count, total_count, coverage_ratio, risk_free_rate,
                          calc_version, updated_at
                   FROM fund_category_metrics_snapshot
                   WHERE as_of_date = ? AND window_days = ?
                   ORDER BY category""",
                (as_of_date, int(window_days)),
            ).fetchall()
        result = {"as_of_date": as_of_date, "window_days": int(window_days), "rows": [dict(r) for r in rows]}
        _qcache.set(cache_key, result, 300)
        return result

    @staticmethod
    def data_status() -> dict[str, Any]:
        with get_db() as conn:
            tables = {}
            for name in [
                "fund_master", "fund_quote_snapshot", "fund_nav_history",
                "fund_metrics_snapshot", "fund_holdings_snapshot", "fund_category_metrics_snapshot", "fund_data_job",
                "external_api_call_log", "fund_snapshot", "fund_pool", "fund_nav_cache",
            ]:
                try:
                    tables[name] = conn.execute(f"SELECT COUNT(*) as c FROM {name}").fetchone()["c"]
                except sqlite3.OperationalError:
                    tables[name] = None
            calls = conn.execute(
                """SELECT source,
                          COUNT(*) as total,
                          SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures,
                          AVG(duration_ms) as avg_ms
                   FROM external_api_call_log
                   WHERE created_at >= datetime('now', '-1 day')
                   GROUP BY source
                   ORDER BY total DESC"""
            ).fetchall()
            jobs = conn.execute(
                "SELECT status, COUNT(*) as c FROM fund_data_job GROUP BY status"
            ).fetchall()
            quote_ts = conn.execute("SELECT MAX(updated_at) as t FROM fund_quote_snapshot").fetchone()["t"]
        return {
            "tables": tables,
            "quote_updated_at": quote_ts,
            "quote_stale_level": _stale_level(quote_ts),
            "api_calls_24h": [dict(row) for row in calls],
            "jobs": {row["status"]: row["c"] for row in jobs},
        }

    @staticmethod
    def cleanup_stale_data() -> dict[str, int]:
        """Remove stale rows from growing tables. Returns counts deleted."""
        from datetime import timedelta
        now = datetime.now()
        results: dict[str, int] = {}
        with get_db() as conn:
            cutoff_7d = (now - timedelta(days=7)).isoformat()
            cur = conn.execute(
                "DELETE FROM external_api_call_log WHERE created_at < ?", (cutoff_7d,)
            )
            results["external_api_call_log"] = cur.rowcount

            cutoff_3d = (now - timedelta(days=3)).isoformat()
            cur = conn.execute(
                """DELETE FROM fund_data_job
                   WHERE status IN ('done', 'failed', 'cancelled')
                     AND updated_at < ?""",
                (cutoff_3d,),
            )
            results["fund_data_job"] = cur.rowcount

            cutoff_30d = (now - timedelta(days=30)).isoformat()
            cur = conn.execute(
                "DELETE FROM fund_nav_cache WHERE computed_at < ?", (cutoff_30d,)
            )
            results["fund_nav_cache"] = cur.rowcount
        return results
