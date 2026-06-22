"""Next-best-action suggestions for institution workspaces."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any


HIGH_EQUITY_ASSETS = {"equity", "stock", "hybrid", "equity_fund", "growth"}


def generate_nba_suggestions(client_360: dict[str, Any], context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Generate manual-only next-best-action suggestions.

    The engine never sends messages and never persists outreach state. It only
    prepares suggestions for a relationship manager to review.
    """
    context = context or {}
    suggestions: list[dict[str, Any]] = []
    risk_level = str(client_360.get("risk_level") or "unknown").lower()
    holdings = client_360.get("holding_assets") if isinstance(client_360.get("holding_assets"), dict) else {}
    data_quality = client_360.get("data_quality") if isinstance(client_360.get("data_quality"), dict) else {}

    if risk_level == "unknown":
        suggestions.append(
            _suggestion(
                "complete_risk_profile",
                "Complete client risk profile",
                "high",
                "Risk level is missing, so suitability checks cannot be finalized.",
                ["risk_level", "investment_horizon", "loss_tolerance"],
            )
        )

    if not holdings:
        suggestions.append(
            _suggestion(
                "confirm_holdings",
                "Confirm current fund holdings",
                "high",
                "No current holdings were supplied for portfolio review.",
                ["current_holdings", "position_weights"],
            )
        )

    if risk_level in {"conservative", "moderate"} and _has_high_equity_exposure(holdings):
        suggestions.append(
            _suggestion(
                "suitability_review",
                "Review suitability and drawdown exposure",
                "high",
                "Client risk level may be inconsistent with higher-volatility assets.",
                ["risk_level", "holding_assets", "drawdown_metrics"],
            )
        )

    if str(context.get("dca_status") or "").lower() in {"missing", "partial"}:
        suggestions.append(
            _suggestion(
                "dca_evidence_review",
                "Refresh DCA backtest evidence",
                "medium",
                "DCA evidence is not complete enough for a strategy recommendation.",
                ["historical_nav", "dca_backtest"],
            )
        )

    if str(context.get("professional_score_status") or data_quality.get("status") or "").lower() in {"missing", "partial"}:
        suggestions.append(
            _suggestion(
                "professional_evidence_review",
                "Complete professional product evidence",
                "medium",
                "Product evaluation is incomplete and should be reviewed before recommendation.",
                ["professional_score", "data_quality", "fund_evidence"],
            )
        )

    if not suggestions:
        suggestions.append(
            _suggestion(
                "periodic_review",
                "Prepare periodic portfolio review",
                "low",
                "Client profile has enough baseline data for a scheduled review.",
                ["client_profile", "holding_assets", "market_context"],
            )
        )

    return {
        "client_ref": client_360.get("client_ref"),
        "suggestions": suggestions,
        "policy": {
            "manual_only": True,
            "auto_send": False,
            "auto_outreach": False,
        },
        "generated_at": datetime.now().isoformat(),
    }


def build_task_drafts(suggestions: list[dict[str, Any]]) -> dict[str, Any]:
    """Convert suggestions into manual task drafts."""
    tasks = []
    for index, suggestion in enumerate(suggestions, start=1):
        due_days = 1 if suggestion.get("priority") == "high" else 3
        tasks.append(
            {
                "id": f"task_{index:02d}_{suggestion.get('id', 'review')}",
                "source_suggestion_id": suggestion.get("id"),
                "title": suggestion.get("title") or "Manual client review",
                "note": suggestion.get("rationale") or "",
                "status": "draft",
                "requires_manual_approval": True,
                "auto_send": False,
                "due_date": (datetime.now() + timedelta(days=due_days)).date().isoformat(),
            }
        )
    return {
        "tasks": tasks,
        "policy": {
            "manual_only": True,
            "auto_send": False,
        },
        "generated_at": datetime.now().isoformat(),
    }


def _suggestion(
    action_type: str,
    title: str,
    priority: str,
    rationale: str,
    required_evidence: list[str],
) -> dict[str, Any]:
    return {
        "id": action_type,
        "action_type": action_type,
        "title": title,
        "priority": priority,
        "rationale": rationale,
        "required_evidence": required_evidence,
        "manual_only": True,
        "auto_send": False,
        "status": "draft",
    }


def _has_high_equity_exposure(holdings: dict[str, Any]) -> bool:
    for asset, weight in holdings.items():
        if str(asset).lower() not in HIGH_EQUITY_ASSETS:
            continue
        try:
            if float(weight) >= 0.35:
                return True
        except (TypeError, ValueError):
            continue
    return False
