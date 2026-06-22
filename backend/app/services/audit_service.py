from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from ..storage.database import get_db


def write_audit_event(
    event_type: str,
    payload: dict[str, Any],
    actor_user_id: str | None = None,
    target_client_id: str | None = None,
    owner_user_id: str | None = None,
    plan_id: str | None = None,
    data_status: str = "real",
    compliance_audit_id: str | None = None,
) -> str:
    audit_id = uuid.uuid4().hex
    now = datetime.now(UTC)
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO suitability_audit_log
                (id, event_type, actor_user_id, target_client_id, owner_user_id, plan_id,
                 payload_json, compliance_audit_id, data_status, created_at, retention_until)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                audit_id,
                event_type,
                actor_user_id,
                target_client_id,
                owner_user_id,
                plan_id,
                json.dumps(payload, ensure_ascii=False),
                compliance_audit_id,
                data_status,
                now.isoformat(),
                (now + timedelta(days=365 * 7)).isoformat(),
            ),
        )
    return audit_id


def write_sales_generation(
    generation_id: str,
    scenario: str,
    content: str,
    data_status: str,
    suitability_decision: str,
    compliance_level: str,
    compliance_issues: list[str],
    evidence_refs: list[dict[str, Any]],
    audit_id: str,
    owner_user_id: str | None = None,
    plan_id: str | None = None,
    fund_code: str | None = None,
    portfolio_id: str | None = None,
    missing_reason: str | None = None,
) -> None:
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO sales_talk_generations
                (id, template_id, plan_id, fund_code, portfolio_id, owner_user_id, scenario,
                 content, data_status, missing_reason, evidence_refs_json, compliance_level,
                 compliance_issues_json, suitability_decision, audit_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                generation_id,
                None,
                plan_id,
                fund_code,
                portfolio_id,
                owner_user_id,
                scenario,
                content,
                data_status,
                missing_reason,
                json.dumps(evidence_refs, ensure_ascii=False),
                compliance_level,
                json.dumps(compliance_issues, ensure_ascii=False),
                suitability_decision,
                audit_id,
                datetime.now(UTC).isoformat(),
            ),
        )
