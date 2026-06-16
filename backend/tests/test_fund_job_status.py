import json
import subprocess

import pytest

from app.data import scheduler
from app.storage import database
from app.storage.database import FundDataStore, init_db


@pytest.fixture()
def isolated_db(tmp_path, monkeypatch):
    conn = getattr(database._local, "conn", None)
    if conn is not None:
        conn.close()
        database._local.conn = None
    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "fundtrader-test.db")
    init_db()
    yield
    conn = getattr(database._local, "conn", None)
    if conn is not None:
        conn.close()
        database._local.conn = None


def test_fund_job_lifecycle_is_persisted(isolated_db):
    job_id = FundDataStore.create_job(
        "fund-detail-backfill",
        code="000001",
        payload={"reason": "test"},
    )
    job = FundDataStore.update_job(
        job_id,
        status="running",
        step="fetch_tushare_holdings",
        progress=0.36,
        source="tushare",
        processed=120,
        total=500,
    )

    assert job["jobId"] == job_id
    assert job["status"] == "running"
    assert job["step"] == "fetch_tushare_holdings"
    assert job["source"] == "tushare"
    assert job["processed"] == 120
    assert job["total"] == 500
    assert job["progress"] == 0.36

    status = FundDataStore.data_status()
    assert status["jobs"]["running"] == 1
    assert status["activeJobs"][0]["jobId"] == job_id
    assert "jobStatusContract" in status


def test_scheduler_records_backfill_script_status(isolated_db, monkeypatch):
    def fake_run(*args, **kwargs):
        payload = {"success": 2, "failed": 1, "total": 3, "rows": 9}
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout=f"noise\n{json.dumps(payload, indent=2)}\n",
            stderr="",
        )

    monkeypatch.setattr(subprocess, "run", fake_run)

    result = scheduler._run_script("metrics", ["--limit", "3"])

    assert result["returncode"] == 0
    job = FundDataStore.get_job(result["job_id"])
    assert job["status"] == "succeeded"
    assert job["step"] == "finish_metrics"
    assert job["source"] == "sqlite_nav_history"
    assert job["processed"] == 3
    assert job["total"] == 3
    assert job["result"]["rows"] == 9
