"""Professional fund evaluation with evidence completeness gates."""
from __future__ import annotations

from typing import Any

from .models import EvidenceRef, FusionDataQuality, ProfessionalPillarScore, ProfessionalScoreResponse

COMPLETENESS_THRESHOLD = 0.65


def build_professional_score(
    *,
    code: str,
    name: str = "",
    metrics: dict[str, Any],
    snapshot: dict[str, Any] | None,
    asset_allocation: dict[str, Any],
    industry_distribution: dict[str, Any],
    style_profile: dict[str, Any],
    brinson_attribution: dict[str, Any],
) -> ProfessionalScoreResponse:
    pillars = [
        _performance_pillar(metrics),
        _risk_pillar(metrics),
        _cost_pillar(snapshot),
        _style_pillar(style_profile),
        _holdings_pillar(asset_allocation, industry_distribution, brinson_attribution),
    ]
    completeness = _evidence_completeness(pillars)
    warnings = []
    available_scores = [pillar.score for pillar in pillars if pillar.status in ("real", "partial")]
    if completeness < COMPLETENESS_THRESHOLD:
        total_score = None
        warnings.append("Evidence completeness is below threshold; total score is downgraded to missing.")
        status = "missing" if completeness == 0 else "partial"
    elif available_scores:
        total_score = round(sum(available_scores) / len(available_scores), 2)
        if completeness < 0.8:
            total_score = min(total_score, 70.0)
            warnings.append("Evidence completeness is below 80%; total score is capped at 70.")
        status = "real" if completeness >= 0.9 else "partial"
    else:
        total_score = None
        status = "missing"
        warnings.append("No scoreable professional evaluation evidence is available.")

    return ProfessionalScoreResponse(
        fund_code=code,
        fund_name=name,
        total_score=total_score,
        pillars=pillars,
        evidence_completeness=round(completeness, 4),
        data_quality=FusionDataQuality(
            status=status,
            source="professional_evaluation",
            coverage=round(completeness, 4),
            confidence=0.85 if status == "real" else 0.55 if status == "partial" else 0,
            missing_reason="; ".join(warnings) if warnings else None,
            warnings=warnings,
        ),
        warnings=warnings,
    )


def _performance_pillar(metrics: dict[str, Any]) -> ProfessionalPillarScore:
    annual_return = _to_float(metrics.get("annualized_return"))
    sharpe = _to_float(metrics.get("sharpe_ratio"))
    refs = []
    if annual_return is not None:
        refs.append(EvidenceRef(source="fund_nav_history", description="Annualized return computed from real NAV history.", confidence=0.85))
    if sharpe is not None:
        refs.append(EvidenceRef(source="fund_nav_history", description="Sharpe ratio computed from real NAV history.", confidence=0.85))
    if not refs:
        return _missing_pillar("performance", "Missing NAV return evidence.")
    score = 50
    if annual_return is not None:
        score += max(-20, min(25, annual_return * 1.5))
    if sharpe is not None:
        score += max(-15, min(25, sharpe * 12))
    return ProfessionalPillarScore(pillar="performance", score=_clamp_score(score), status="real", evidence_refs=refs)


def _risk_pillar(metrics: dict[str, Any]) -> ProfessionalPillarScore:
    max_drawdown = _to_float(metrics.get("max_drawdown"))
    volatility = _to_float(metrics.get("volatility"))
    refs = []
    if max_drawdown is not None:
        refs.append(EvidenceRef(source="fund_nav_history", description="Maximum drawdown computed from real NAV history.", confidence=0.85))
    if volatility is not None:
        refs.append(EvidenceRef(source="fund_nav_history", description="Annualized volatility computed from real NAV history.", confidence=0.85))
    if not refs:
        return _missing_pillar("risk", "Missing NAV risk evidence.")
    drawdown_penalty = min(35, abs(max_drawdown or 0) * 1.2)
    vol_penalty = min(25, abs(volatility or 0) * 0.8)
    return ProfessionalPillarScore(pillar="risk", score=_clamp_score(95 - drawdown_penalty - vol_penalty), status="real", evidence_refs=refs)


def _cost_pillar(snapshot: dict[str, Any] | None) -> ProfessionalPillarScore:
    if not snapshot:
        return _missing_pillar("cost", "Missing fund snapshot and fee evidence.")
    fee = _first_number(snapshot.get("management_fee"), snapshot.get("fee_manage"))
    custody = _first_number(snapshot.get("custody_fee"), snapshot.get("fee_custody"))
    refs = []
    if fee is not None:
        refs.append(EvidenceRef(source="fund_metadata_cache/fund_metrics_snapshot", description="Management fee evidence is available.", confidence=0.75))
    if custody is not None:
        refs.append(EvidenceRef(source="fund_metadata_cache/fund_metrics_snapshot", description="Custody fee evidence is available.", confidence=0.75))
    if not refs:
        return _missing_pillar("cost", "Missing management or custody fee evidence.")
    total_fee = (fee or 0) + (custody or 0)
    score = 95 - min(60, total_fee * 4000)
    return ProfessionalPillarScore(pillar="cost", score=_clamp_score(score), status="real" if len(refs) == 2 else "partial", evidence_refs=refs)


def _style_pillar(style_profile: dict[str, Any]) -> ProfessionalPillarScore:
    refs = [EvidenceRef(**ref) for ref in style_profile.get("evidence_refs") or []]
    status = style_profile.get("status") or "missing"
    if not refs:
        return _missing_pillar("style", "Missing NAV or holdings style evidence.")
    coverage = ((style_profile.get("data_quality") or {}).get("coverage") or 0)
    score = 50 + 45 * float(coverage)
    return ProfessionalPillarScore(pillar="style", score=_clamp_score(score), status=status, evidence_refs=refs)


def _holdings_pillar(
    asset_allocation: dict[str, Any],
    industry_distribution: dict[str, Any],
    brinson_attribution: dict[str, Any],
) -> ProfessionalPillarScore:
    refs = []
    if asset_allocation.get("dataStatus") in ("available", "partial"):
        refs.append(EvidenceRef(source=asset_allocation.get("source") or "portfolio_stock_holdings", description="Asset allocation reviewed from real holdings.", confidence=0.7))
    if industry_distribution.get("dataStatus") in ("available", "partial"):
        refs.append(EvidenceRef(source=industry_distribution.get("source") or "portfolio_stock_holdings", description="Industry distribution reviewed from real holdings.", confidence=0.75))
    refs.extend(EvidenceRef(**ref) for ref in brinson_attribution.get("evidence_refs") or [])
    if not refs:
        return _missing_pillar("holdings", "Missing holdings, industry, and attribution evidence.")
    status = "partial" if brinson_attribution.get("status") != "real" else "real"
    score = 60 + min(30, len(refs) * 8)
    return ProfessionalPillarScore(pillar="holdings", score=_clamp_score(score), status=status, evidence_refs=refs)


def _missing_pillar(pillar: str, reason: str) -> ProfessionalPillarScore:
    return ProfessionalPillarScore(pillar=pillar, score=0, status="missing", evidence_refs=[], missing_reason=reason)


def _evidence_completeness(pillars: list[ProfessionalPillarScore]) -> float:
    if not pillars:
        return 0
    weights = {"performance": 0.25, "risk": 0.25, "cost": 0.15, "style": 0.15, "holdings": 0.2}
    status_score = {"real": 1.0, "partial": 0.55, "stale": 0.35, "assumption": 0.25, "missing": 0.0, "rejected": 0.0}
    total = 0.0
    for pillar in pillars:
        total += weights.get(pillar.pillar, 0.2) * status_score.get(pillar.status, 0.0)
    return min(1.0, total)


def _first_number(*values: Any) -> float | None:
    for value in values:
        number = _to_float(value)
        if number is not None:
            return number
    return None


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace("%", ""))
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def _clamp_score(value: float) -> float:
    return round(max(0.0, min(100.0, float(value))), 2)
