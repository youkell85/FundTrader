"""Stable progress stream event contract for long-running FundTrader jobs."""
from __future__ import annotations

import json
from typing import Any


def build_progress_event(job: dict[str, Any] | None, *, job_id: str | None = None) -> dict[str, Any]:
    """Normalize stored job status into a realtime/SSE-safe event payload."""
    if not job:
        missing_id = job_id or ""
        return {
            "type": "progress",
            "job_id": missing_id,
            "jobId": missing_id,
            "status": "missing",
            "step": "missing",
            "progress": 0.0,
            "source": None,
            "processed": 0,
            "total": 0,
            "error": "job not found",
            "data_quality": {
                "status": "missing",
                "missing_reason": "job not found",
            },
        }

    status = str(job.get("status") or "pending")
    error = job.get("error")
    quality_status = "available"
    missing_reason = None
    if status in {"failed", "cancelled"}:
        quality_status = "missing"
        missing_reason = error or status
    elif status in {"pending", "running"}:
        quality_status = "partial"
        missing_reason = "job still running" if status == "running" else "job pending"

    normalized_id = str(job.get("job_id") or job.get("jobId") or job_id or "")
    return {
        "type": "progress",
        "job_id": normalized_id,
        "jobId": normalized_id,
        "job_type": job.get("job_type") or job.get("jobType"),
        "jobType": job.get("jobType") or job.get("job_type"),
        "status": status,
        "step": job.get("step") or status,
        "progress": max(0.0, min(1.0, float(job.get("progress") or 0.0))),
        "source": job.get("source"),
        "processed": int(job.get("processed") or 0),
        "total": int(job.get("total") or 0),
        "error": error,
        "updated_at": job.get("updated_at") or job.get("updatedAt"),
        "data_quality": {
            "status": quality_status,
            "missing_reason": missing_reason,
        },
    }


def encode_sse_event(event: dict[str, Any], *, event_name: str = "progress") -> str:
    """Encode a progress payload as a deterministic SSE frame."""
    payload = json.dumps(event, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"event: {event_name}\ndata: {payload}\n\n"
