"""Portfolio construction engine backed by the real fund snapshot pool."""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from ..storage.database import FundDataStore
from .models import (
    EvidenceRef,
    FusionDataQuality,
    PortfolioBuildRequest,
    PortfolioBuildResponse,
    PortfolioCandidate,
    PortfolioHoldingItem,
    PortfolioRole,
    PortfolioXRay,
    RiskTolerance,
)


RISK_TARGETS: dict[RiskTolerance, dict[str, float]] = {
    "conservative": {"bond": 0.55, "cash": 0.15, "mixed": 0.2, "equity": 0.1},
    "moderate": {"bond": 0.4, "mixed": 0.3, "equity": 0.25, "cash": 0.05},
    "balanced": {"mixed": 0.35, "equity": 0.35, "bond": 0.2, "index": 0.1},
    "aggressive": {"equity": 0.45, "index": 0.25, "mixed": 0.2, "qdii": 0.1},
    "radical": {"equity": 0.5, "index": 0.25, "qdii": 0.15, "mixed": 0.1},
}


ROLE_BY_ASSET: dict[str, PortfolioRole] = {
    "bond": "defensive",
    "cash": "liquidity",
    "equity": "satellite",
    "index": "core",
    "mixed": "core",
    "qdii": "alternative",
    "alternative": "alternative",
}


def list_portfolio_candidates(limit: int = 120) -> tuple[list[PortfolioCandidate], FusionDataQuality, list[EvidenceRef]]:
    """Return buildable candidates from current fund snapshots only."""
    snapshots = _load_snapshot_candidates(limit=limit)
    if not snapshots:
        return (
            [],
            FusionDataQuality(
                status="missing",
                source="fund_snapshot",
                coverage=0,
                confidence=0,
                missing_reason="No active real fund snapshots are available.",
            ),
            [],
        )

    candidates = [_candidate_from_snapshot(row) for row in snapshots]
    return (
        candidates,
        FusionDataQuality(
            status="real",
            source="fund_snapshot",
            as_of=_latest_as_of(snapshots),
            coverage=1,
            confidence=0.9,
        ),
        [
            EvidenceRef(
                source="fund_snapshot",
                as_of=_latest_as_of(snapshots),
                description=f"{len(candidates)} candidates loaded from active fund snapshots.",
                confidence=0.9,
            )
        ],
    )


def build_portfolio(request: PortfolioBuildRequest) -> PortfolioBuildResponse:
    """Build a constrained model portfolio without replacing missing seed funds."""
    requested_codes = [c.fund_code.strip() for c in request.candidates if c.fund_code.strip()]
    warnings: list[str] = []

    if requested_codes:
        snapshots_by_code = _load_snapshots_by_codes(requested_codes)
        candidates: list[dict[str, Any]] = []
        for seed in request.candidates:
            code = seed.fund_code.strip()
            snapshot = snapshots_by_code.get(code)
            if not snapshot:
                warnings.append(f"Requested fund {code} is missing from the active fund pool; it was not replaced.")
                continue
            candidates.append(_merge_seed_with_snapshot(seed, snapshot))
    else:
        candidates = _load_snapshot_candidates(limit=max(request.constraints.max_fund_count * 8, 40))

    if not candidates:
        return PortfolioBuildResponse(
            portfolio_id=None,
            holdings=[],
            xray=PortfolioXRay(),
            suitability_status="rejected",
            data_quality=FusionDataQuality(
                status="missing",
                source="fund_snapshot",
                coverage=0,
                confidence=0,
                missing_reason="No valid real fund candidates are available for portfolio construction.",
                warnings=warnings,
            ),
            evidence_refs=[],
            warnings=warnings,
        )

    selected = _select_candidates(candidates, request)
    if not selected:
        warnings.append("Candidate pool is present but constraints left no buildable holdings.")
        return PortfolioBuildResponse(
            portfolio_id=None,
            holdings=[],
            xray=PortfolioXRay(),
            suitability_status="rejected",
            data_quality=FusionDataQuality(
                status="missing",
                source="fund_snapshot",
                coverage=0,
                confidence=0,
                missing_reason="No holdings survived the requested constraints.",
                warnings=warnings,
            ),
            evidence_refs=[],
            warnings=warnings,
        )

    weights, weight_warnings = _assign_weights(selected, request)
    warnings.extend(weight_warnings)
    holdings = [
        PortfolioHoldingItem(
            fund_code=item["code"],
            fund_name=item.get("name") or item["code"],
            weight=round(weights[item["code"]], 6),
            role=item.get("role") or ROLE_BY_ASSET.get(item.get("asset_class") or "mixed", "core"),
            rationale=_holding_rationale(item, request.risk_tolerance),
            data_quality=_holding_quality(item),
        )
        for item in selected
        if weights.get(item["code"], 0) > 0
    ]
    xray = _build_xray(holdings, selected)
    status = _portfolio_status(holdings, requested_count=len(requested_codes), warnings=warnings)
    data_quality = FusionDataQuality(
        status=status,
        source="fund_snapshot",
        as_of=_latest_as_of(selected),
        coverage=_coverage(holdings, max(len(requested_codes), len(selected))),
        confidence=0.9 if status == "real" else 0.65 if status == "partial" else 0,
        missing_reason="; ".join(warnings) if status != "real" and warnings else None,
        warnings=warnings,
    )
    return PortfolioBuildResponse(
        portfolio_id=f"pf_{uuid4().hex[:12]}",
        holdings=holdings,
        xray=xray,
        suitability_status=_suitability_status(request.risk_tolerance, xray),
        data_quality=data_quality,
        evidence_refs=[
            EvidenceRef(
                source="fund_snapshot",
                as_of=data_quality.as_of,
                description="Portfolio holdings selected from current active fund snapshots; missing seed funds are not replaced.",
                confidence=data_quality.confidence,
            )
        ],
        warnings=warnings,
    )


def _load_snapshot_candidates(limit: int) -> list[dict[str, Any]]:
    result = FundDataStore.list_snapshots(
        xinjihui_only=True,
        limit=limit,
        offset=0,
        sort_field="near_1y",
        sort_order="desc",
    )
    funds = result.get("funds") or []
    return [
        _normalize_snapshot(fund)
        for fund in funds
        if isinstance(fund, dict) and fund.get("code") and fund.get("name") and _to_float(fund.get("nav")) is not None
    ]


def _load_snapshots_by_codes(codes: list[str]) -> dict[str, dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for code in dict.fromkeys(codes):
        snapshot = FundDataStore.get_snapshot(code)
        if snapshot and _to_float(snapshot.get("nav")) is not None:
            result[code] = _normalize_snapshot(snapshot)
    return result


def _normalize_snapshot(fund: dict[str, Any]) -> dict[str, Any]:
    asset_class = infer_asset_class(fund)
    return {
        **fund,
        "code": str(fund.get("code") or "").strip(),
        "name": str(fund.get("name") or "").strip(),
        "type": str(fund.get("type") or fund.get("fund_type") or "").strip(),
        "asset_class": asset_class,
        "role": ROLE_BY_ASSET.get(asset_class, "core"),
        "score_value": _first_number(fund.get("score"), fund.get("annualized_return"), fund.get("near_1y"), 0) or 0,
        "as_of": fund.get("nav_date") or fund.get("updated_at") or fund.get("metrics_updated_at"),
    }


def _candidate_from_snapshot(fund: dict[str, Any]) -> PortfolioCandidate:
    status = _metric_status(fund)
    return PortfolioCandidate(
        fund_code=fund["code"],
        fund_name=fund["name"],
        asset_class=fund["asset_class"],
        role=fund.get("role") or "core",
        min_weight=0,
        max_weight=0.3,
        metadata_status=status,
        missing_reason=None if status != "missing" else "Missing risk and return metrics.",
    )


def _merge_seed_with_snapshot(seed: PortfolioCandidate, snapshot: dict[str, Any]) -> dict[str, Any]:
    merged = dict(snapshot)
    if seed.fund_name:
        merged["name"] = seed.fund_name
    if seed.asset_class:
        merged["asset_class"] = seed.asset_class
    merged["role"] = seed.role
    merged["min_weight"] = seed.min_weight
    merged["max_weight"] = seed.max_weight
    return merged


def infer_asset_class(fund: dict[str, Any]) -> str:
    text = " ".join(
        [
            str(fund.get("asset_class") or ""),
            str(fund.get("type") or fund.get("fund_type") or ""),
            " ".join(str(tag) for tag in fund.get("tags") or []),
            str(fund.get("name") or ""),
        ]
    ).lower()
    if any(token in text for token in ("货币", "money", "cash")):
        return "cash"
    if any(token in text for token in ("债", "bond", "固收")):
        return "bond"
    if any(token in text for token in ("qdii", "港", "海外", "global")):
        return "qdii"
    if any(token in text for token in ("指数", "index", "etf")):
        return "index"
    if any(token in text for token in ("股票", "equity", "stock")):
        return "equity"
    if any(token in text for token in ("混合", "balanced", "mixed")):
        return "mixed"
    return "mixed"


def _select_candidates(candidates: list[dict[str, Any]], request: PortfolioBuildRequest) -> list[dict[str, Any]]:
    max_count = max(1, request.constraints.max_fund_count)
    min_count = min(max(1, request.constraints.min_fund_count), max_count)
    targets = _target_weights(request)
    selected: list[dict[str, Any]] = []
    used_codes: set[str] = set()
    sorted_candidates = sorted(candidates, key=lambda item: (item.get("score_value") or 0, item.get("code") or ""), reverse=True)

    for asset_class in targets:
        bucket = [item for item in sorted_candidates if item["asset_class"] == asset_class and item["code"] not in used_codes]
        if bucket:
            selected.append(bucket[0])
            used_codes.add(bucket[0]["code"])
        if len(selected) >= max_count:
            break

    for item in sorted_candidates:
        if len(selected) >= max_count:
            break
        if item["code"] in used_codes:
            continue
        selected.append(item)
        used_codes.add(item["code"])
        if len(selected) >= min_count and request.candidates:
            break

    return selected


def _assign_weights(selected: list[dict[str, Any]], request: PortfolioBuildRequest) -> tuple[dict[str, float], list[str]]:
    warnings: list[str] = []
    targets = _target_weights(request)
    groups: dict[str, list[dict[str, Any]]] = {}
    for item in selected:
        groups.setdefault(item["asset_class"], []).append(item)

    available_target = {asset: weight for asset, weight in targets.items() if groups.get(asset)}
    missing_target_weight = sum(weight for asset, weight in targets.items() if not groups.get(asset))
    if missing_target_weight > 0:
        warnings.append("Some target asset classes have no real fund candidates; weight was redistributed across available selected funds.")

    if not available_target:
        available_target = {asset: 1 / len(groups) for asset in groups}
    else:
        total = sum(available_target.values()) or 1
        available_target = {asset: weight / total for asset, weight in available_target.items()}

    weights: dict[str, float] = {}
    for asset, group in groups.items():
        asset_weight = available_target.get(asset, 0)
        if asset_weight <= 0:
            continue
        per_fund = asset_weight / len(group)
        for item in group:
            weights[item["code"]] = per_fund

    return _cap_and_normalize(weights, selected, request.constraints.max_single_fund_weight, warnings), warnings


def _cap_and_normalize(weights: dict[str, float], selected: list[dict[str, Any]], max_single: float, warnings: list[str]) -> dict[str, float]:
    if not weights:
        return {}
    caps = {
        item["code"]: min(float(item.get("max_weight") or 1), max_single or 1)
        for item in selected
        if item["code"] in weights
    }
    min_possible_cap = 1 / max(len(weights), 1)
    if any(cap < min_possible_cap for cap in caps.values()):
        warnings.append("Max single fund weight is below the feasible equal-weight floor; effective caps were relaxed.")
        caps = {code: max(cap, min_possible_cap) for code, cap in caps.items()}

    for _ in range(8):
        overweight = {code: weight - caps[code] for code, weight in weights.items() if weight > caps[code]}
        if not overweight:
            break
        excess = sum(overweight.values())
        for code in overweight:
            weights[code] = caps[code]
        receivers = [code for code in weights if weights[code] < caps[code]]
        if not receivers:
            break
        room = sum(caps[code] - weights[code] for code in receivers)
        if room <= 0:
            break
        for code in receivers:
            weights[code] += excess * ((caps[code] - weights[code]) / room)

    total = sum(weights.values()) or 1
    return {code: max(0, weight / total) for code, weight in weights.items()}


def _target_weights(request: PortfolioBuildRequest) -> dict[str, float]:
    raw = request.constraints.target_asset_weights or RISK_TARGETS.get(request.risk_tolerance, RISK_TARGETS["balanced"])
    normalized: dict[str, float] = {}
    for key, value in raw.items():
        number = _to_float(value)
        if number is None or number <= 0:
            continue
        normalized[infer_asset_class({"asset_class": key}) if key not in ROLE_BY_ASSET else key] = number / 100 if number > 1 else number
    total = sum(normalized.values()) or 1
    return {key: value / total for key, value in normalized.items()}


def _build_xray(holdings: list[PortfolioHoldingItem], selected: list[dict[str, Any]]) -> PortfolioXRay:
    by_code = {item["code"]: item for item in selected}
    asset_weights: dict[str, float] = {}
    fee_values: list[tuple[float, float]] = []
    for holding in holdings:
        item = by_code.get(holding.fund_code, {})
        asset = item.get("asset_class") or "mixed"
        asset_weights[asset] = asset_weights.get(asset, 0) + holding.weight
        fee = _first_number(item.get("management_fee"), item.get("fee_manage"))
        custody = _first_number(item.get("custody_fee"), item.get("fee_custody"))
        if fee is not None or custody is not None:
            fee_values.append(((fee or 0) + (custody or 0), holding.weight))
    top3 = sum(sorted((h.weight for h in holdings), reverse=True)[:3])
    overlap = []
    if top3 > 0.75:
        overlap.append("Top 3 holdings exceed 75%; review concentration before client-facing use.")
    return PortfolioXRay(
        asset_weights={key: round(value, 6) for key, value in asset_weights.items()},
        fund_count=len(holdings),
        concentration_top3=round(top3, 6),
        estimated_fee=_weighted_average(fee_values) if fee_values else None,
        overlap_warnings=overlap,
    )


def _holding_quality(item: dict[str, Any]) -> FusionDataQuality:
    status = _metric_status(item)
    return FusionDataQuality(
        status=status,
        source="fund_snapshot",
        as_of=item.get("as_of"),
        coverage=1 if status == "real" else 0.5 if status == "partial" else 0,
        confidence=0.9 if status == "real" else 0.6 if status == "partial" else 0,
        missing_reason=None if status != "missing" else "Missing risk and return metrics.",
    )


def _holding_rationale(item: dict[str, Any], risk_tolerance: RiskTolerance) -> str:
    asset = item.get("asset_class") or "mixed"
    score = _first_number(item.get("score"), item.get("annualized_return"), item.get("near_1y"))
    score_part = f" snapshot score {score:.2f}" if score is not None else " available snapshot metadata"
    return f"Selected as {asset} exposure for {risk_tolerance} risk profile based on{score_part}."


def _portfolio_status(holdings: list[PortfolioHoldingItem], requested_count: int, warnings: list[str]) -> str:
    if not holdings:
        return "missing"
    if warnings or any(h.data_quality.status != "real" for h in holdings):
        return "partial"
    if requested_count and len(holdings) < requested_count:
        return "partial"
    return "real"


def _suitability_status(risk_tolerance: RiskTolerance, xray: PortfolioXRay) -> str:
    growth_weight = sum(xray.asset_weights.get(asset, 0) for asset in ("equity", "index", "qdii", "alternative"))
    if risk_tolerance == "conservative" and growth_weight > 0.45:
        return "review_required"
    if xray.fund_count < 2:
        return "review_required"
    return "approved"


def _metric_status(item: dict[str, Any]) -> str:
    has_return = _first_number(item.get("annualized_return"), item.get("near_1y")) is not None
    has_risk = _first_number(item.get("volatility"), item.get("max_drawdown")) is not None
    if has_return and has_risk:
        return "real"
    if has_return or has_risk:
        return "partial"
    return "missing"


def _coverage(holdings: list[PortfolioHoldingItem], denominator: int) -> float:
    if denominator <= 0:
        return 0
    realish = sum(1 for holding in holdings if holding.data_quality.status in ("real", "partial"))
    return round(min(1, realish / denominator), 4)


def _latest_as_of(items: list[dict[str, Any]]) -> str | None:
    dates = [str(item.get("as_of") or item.get("updated_at") or item.get("nav_date") or "") for item in items]
    dates = [value for value in dates if value]
    return max(dates) if dates else datetime.now().date().isoformat()


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


def _weighted_average(values: list[tuple[float, float]]) -> float | None:
    total = sum(weight for _, weight in values if weight > 0)
    if total <= 0:
        return None
    return round(sum(value * weight for value, weight in values) / total, 6)
