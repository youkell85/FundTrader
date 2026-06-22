"""客户 360 画像组装，不持久化直接联系方式。"""
from __future__ import annotations

from datetime import datetime
from typing import Any

DIRECT_CONTACT_KEYS = {
    "phone",
    "mobile",
    "email",
    "wechat",
    "weixin",
    "address",
    "id_card",
    "identity_no",
    "contact",
}


def build_client_360(payload: dict[str, Any], owner_user_id: str | None = None) -> dict[str, Any]:
    """组装内存态客户画像，并剔除直接联系方式字段。"""
    sanitized, removed = _strip_direct_contact(payload)
    client = sanitized.get("client") if isinstance(sanitized.get("client"), dict) else sanitized
    holdings = sanitized.get("holdings") if isinstance(sanitized.get("holdings"), list) else []
    goals = client.get("goals") if isinstance(client.get("goals"), list) else []
    risk_level = str(client.get("risk_level") or client.get("risk_tolerance") or "unknown")
    contact_authorized = bool(client.get("contact_authorized"))
    warnings = []
    if removed:
        warnings.append("已从工作台请求中剔除直接联系方式字段，且不会持久化保存。")
    if contact_authorized:
        warnings.append("已记录客户授权标记，但本阶段仍不会持久化保存直接联系方式。")
    profile = {
        "client_ref": str(client.get("client_ref") or client.get("client_id") or "anonymous_client"),
        "display_name": str(client.get("display_name") or client.get("name") or "客户"),
        "risk_level": risk_level,
        "life_stage": str(client.get("life_stage") or _infer_life_stage(client)),
        "goals": [str(goal) for goal in goals[:6]],
        "holding_count": len(holdings),
        "holding_assets": _holding_asset_summary(holdings),
        "review_focus": _review_focus(risk_level, holdings, goals),
        "owner_user_id": owner_user_id,
        "contact_policy": {
            "direct_contact_storage": "disabled",
            "contact_authorized": contact_authorized,
            "removed_fields": sorted(removed),
        },
        "data_quality": {
            "status": "partial" if risk_level == "unknown" or not holdings else "real",
            "source": "workspace_request",
            "coverage": _coverage(risk_level, holdings, goals),
            "confidence": 0.75,
            "missing_reason": None if risk_level != "unknown" else "客户风险等级缺失。",
        },
        "warnings": warnings,
        "generated_at": datetime.now().isoformat(),
    }
    return profile


def _strip_direct_contact(value: Any) -> tuple[Any, set[str]]:
    removed: set[str] = set()
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            normalized = str(key).lower()
            if normalized in DIRECT_CONTACT_KEYS:
                removed.add(str(key))
                continue
            clean_item, child_removed = _strip_direct_contact(item)
            removed.update(child_removed)
            result[key] = clean_item
        return result, removed
    if isinstance(value, list):
        result = []
        for item in value:
            clean_item, child_removed = _strip_direct_contact(item)
            removed.update(child_removed)
            result.append(clean_item)
        return result, removed
    return value, removed


def _holding_asset_summary(holdings: list[Any]) -> dict[str, float]:
    summary: dict[str, float] = {}
    for item in holdings:
        if not isinstance(item, dict):
            continue
        asset = str(item.get("asset_class") or item.get("asset") or "unknown")
        try:
            weight = float(item.get("weight") or 0)
        except (TypeError, ValueError):
            weight = 0
        summary[asset] = round(summary.get(asset, 0) + weight, 6)
    return summary


def _infer_life_stage(client: dict[str, Any]) -> str:
    try:
        age = int(client.get("age"))
    except (TypeError, ValueError):
        return "unknown"
    if age < 35:
        return "accumulation"
    if age < 55:
        return "family_growth"
    return "pre_retirement"


def _review_focus(risk_level: str, holdings: list[Any], goals: list[Any]) -> list[str]:
    focus = []
    if risk_level == "unknown":
        focus.append("complete_risk_profile")
    if not holdings:
        focus.append("import_or_confirm_holdings")
    if not goals:
        focus.append("confirm_investment_goals")
    if risk_level in {"conservative", "moderate"}:
        focus.append("suitability_and_drawdown_review")
    if not focus:
        focus.append("periodic_portfolio_review")
    return focus


def _coverage(risk_level: str, holdings: list[Any], goals: list[Any]) -> float:
    score = 0.0
    if risk_level != "unknown":
        score += 0.4
    if holdings:
        score += 0.35
    if goals:
        score += 0.25
    return round(score, 4)
