import json

import pytest

from app.jobs.progress_stream import build_progress_event, encode_sse_event
from app.storage import database
from app.storage.database import FundDataStore
from app.storage.database import init_db


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


def test_progress_event_for_running_job_uses_stable_contract(isolated_db):
    job_id = FundDataStore.create_job("fund-detail-backfill", code="000001")
    job = FundDataStore.update_job(
        job_id,
        status="running",
        step="fetch_nav",
        progress=0.25,
        source="tushare",
        processed=10,
        total=40,
    )

    event = build_progress_event(job)

    assert event["job_id"] == job_id
    assert event["jobId"] == job_id
    assert event["status"] == "running"
    assert event["step"] == "fetch_nav"
    assert event["progress"] == 0.25
    assert event["source"] == "tushare"
    assert event["data_quality"]["status"] == "partial"


def test_progress_event_for_failed_job_carries_error_and_missing_quality(isolated_db):
    job_id = FundDataStore.create_job("fund-report-generation", code="000001")
    job = FundDataStore.update_job(
        job_id,
        status="failed",
        step="render_report",
        progress=0.5,
        source="fund_research_report",
        error="provider timeout",
    )

    event = build_progress_event(job)

    assert event["status"] == "failed"
    assert event["error"] == "provider timeout"
    assert event["data_quality"]["status"] == "missing"
    assert event["data_quality"]["missing_reason"] == "provider timeout"


def test_progress_event_for_missing_job_is_explicit():
    event = build_progress_event(None, job_id="missing-job")

    assert event["job_id"] == "missing-job"
    assert event["status"] == "missing"
    assert event["error"] == "job not found"
    assert event["data_quality"]["missing_reason"] == "job not found"


def test_encode_sse_event_is_deterministic_json_frame():
    event = build_progress_event(None, job_id="missing-job")
    frame = encode_sse_event(event)

    assert frame.startswith("event: progress\n")
    assert frame.endswith("\n\n")
    payload = json.loads(frame.split("data: ", 1)[1])
    assert payload["job_id"] == "missing-job"
    assert payload["data_quality"]["status"] == "missing"
