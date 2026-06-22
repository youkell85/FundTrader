"""Model portfolio marketplace assembled from real fund snapshots."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from ..storage.database import get_db
from .models import EvidenceRef, FusionDataQuality, PortfolioCandidate, PortfolioConstraint, PortfolioBuildRequest
from .portfolio_builder import build_portfolio, infer_asset_class


MODEL_DEFINITIONS = [
    {
        "id": "model_prudent_income",
        "name": "稳健收益组合",
        "risk_level": 2,
        "risk_tolerance": "conservative",
        "description": "以债券和现金管理类基金为主，控制权益暴露。",
        "targets": {"bond": 0.6, "cash": 0.15, "mixed": 0.2, "equity": 0.05},
    },
    {
        "id": "model_balanced_growth",
        "name": "均衡增长组合",
        "risk_level": 3,
        "risk_tolerance": "balanced",
        "description": "在混合、权益、债券和指数基金之间分散配置。",
        "targets": {"mixed": 0.35, "equity": 0.3, "bond": 0.25, "index": 0.1},
    },
    {
        "id": "model_growth_plus",
        "name": "进取成长组合",
        "risk_level": 4,
        "risk_tolerance": "aggressive",
        "description": "提高权益和指数基金占比，保留少量多资产缓冲。",
        "targets": {"equity": 0.45, "index": 0.25, "mixed": 0.2, "qdii": 0.1},
    },
]

RISK_DISCLOSURE = "历史测算目标和风险阈值仅用于组合复核，不构成收益承诺或保本承诺。"


def list_model_portfolios(limit: int = 6) -> dict[str, Any]:
    """Return DB-published models when present, otherwise generate from real snapshots."""
    stored = _load_published_model_portfolios(limit=limit)
    if stored:
        return {
            "items": stored,
            "data_quality": {
                "status": "partial" if any(item["data_quality"]["status"] != "real" for item in stored) else "real",
                "source": "model_portfolios",
                "coverage": 1,
                "confidence": 0.75,
            },
            "warnings": [],
        }
    generated = [_generate_model_portfolio(defn) for defn in MODEL_DEFINITIONS[:limit]]
    generated = [item for item in generated if item is not None]
    status = "real" if generated and all(item["data_quality"]["status"] == "real" for item in generated) else "partial" if generated else "missing"
    return {
        "items": generated,
        "data_quality": {
            "status": status,
            "source": "fund_snapshot",
            "coverage": 1 if generated else 0,
            "confidence": 0.85 if generated else 0,
            "missing_reason": None if generated else "No active fund snapshots are available for model portfolio generation.",
        },
        "warnings": [] if generated else ["Model portfolio marketplace has no buildable real fund candidates."],
    }


def _load_published_model_portfolios(limit: int) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, name, risk_level, target_return, max_drawdown, description,
                      risk_disclaimer, created_by, updated_at
               FROM model_portfolios
               WHERE status = 'published'
               ORDER BY risk_level ASC, updated_at DESC
               LIMIT ?""",
            (max(1, min(limit, 50)),),
        ).fetchall()
        if not rows:
            return []
        result = []
        for row in rows:
            holding_rows = conn.execute(
                """SELECT fund_code, fund_name, weight, role, metadata_status,
                          missing_reason, evidence_refs_json
                   FROM model_portfolio_holdings
                   WHERE portfolio_id = ?
                   ORDER BY weight DESC""",
                (row["id"],),
            ).fetchall()
            holdings = []
            missing_count = 0
            evidence_refs = []
            for holding in holding_rows:
                refs = _loads(holding["evidence_refs_json"], [])
                evidence_refs.extend(refs)
                status = holding["metadata_status"] or "missing"
                if status == "missing":
                    missing_count += 1
                holdings.append(
                    {
                        "fund_code": holding["fund_code"],
                        "fund_name": holding["fund_name"],
                        "weight": float(holding["weight"] or 0),
                        "role": holding["role"] or "core",
                        "metadata_status": status,
                        "missing_reason": holding["missing_reason"],
                    }
                )
            quality_status = "missing" if holdings and missing_count == len(holdings) else "partial" if missing_count else "real"
            result.append(
                {
                    "id": row["id"],
                    "name": row["name"],
                    "risk_level": int(row["risk_level"]),
                    "description": row["description"] or "",
                    "target_return": row["target_return"],
                    "max_drawdown": row["max_drawdown"],
                    "target_basis": "historical_measurement_target",
                    "risk_threshold_label": "historical risk threshold",
                    "risk_disclaimer": row["risk_disclaimer"] or RISK_DISCLOSURE,
                    "holdings": holdings,
                    "xray": _xray_from_holdings(holdings),
                    "data_quality": {
                        "status": quality_status,
                        "source": "model_portfolios",
                        "as_of": row["updated_at"],
                        "coverage": 0 if not holdings else round((len(holdings) - missing_count) / len(holdings), 4),
                        "confidence": 0.8 if quality_status == "real" else 0.45,
                        "missing_reason": f"{missing_count} seed holdings are unavailable in the real fund pool." if missing_count else None,
                    },
                    "evidence_refs": evidence_refs,
                    "warnings": [f"{missing_count} seed holdings marked missing; no replacement was made."] if missing_count else [],
                }
            )
        return result


def _generate_model_portfolio(defn: dict[str, Any]) -> dict[str, Any] | None:
    candidates = _candidate_pool_for_targets(defn["targets"])
    if not candidates:
        return None
    request = PortfolioBuildRequest(
        candidates=candidates,
        constraints=PortfolioConstraint(
            max_single_fund_weight=0.28,
            min_fund_count=3,
            max_fund_count=6,
            target_asset_weights=defn["targets"],
        ),
        risk_tolerance=defn["risk_tolerance"],
        amount=100000,
    )
    built = build_portfolio(request)
    if not built.holdings:
        return None
    metrics = _measure_targets(built.holdings, candidates)
    return {
        "id": defn["id"],
        "name": defn["name"],
        "risk_level": defn["risk_level"],
        "description": defn["description"],
        "target_return": metrics["target_return"],
        "max_drawdown": metrics["max_drawdown"],
        "target_basis": "historical_measurement_target",
        "risk_threshold_label": "historical risk threshold",
        "risk_disclaimer": RISK_DISCLOSURE,
        "holdings": [
            {
                "fund_code": h.fund_code,
                "fund_name": h.fund_name,
                "weight": h.weight,
                "role": h.role,
                "metadata_status": h.data_quality.status,
                "missing_reason": h.data_quality.missing_reason,
            }
            for h in built.holdings
        ],
        "xray": built.xray.model_dump(),
        "data_quality": built.data_quality.model_dump(),
        "evidence_refs": [ref.model_dump() for ref in built.evidence_refs],
        "warnings": built.warnings,
    }


def _candidate_pool_for_targets(targets: dict[str, float]) -> list[PortfolioCandidate]:
    from .portfolio_builder import list_portfolio_candidates

    candidates, _, _ = list_portfolio_candidates(limit=160)
    by_asset: dict[str, list[PortfolioCandidate]] = {}
    for candidate in candidates:
        by_asset.setdefault(candidate.asset_class or infer_asset_class({"asset_class": candidate.asset_class}), []).append(candidate)
    selected: list[PortfolioCandidate] = []
    for asset in targets:
        selected.extend(by_asset.get(asset, [])[:2])
    if len(selected) < 3:
        for candidate in candidates:
            if candidate.fund_code not in {item.fund_code for item in selected}:
                selected.append(candidate)
            if len(selected) >= 6:
                break
    return selected[:8]


def _measure_targets(holdings: list[Any], candidates: list[PortfolioCandidate]) -> dict[str, float | None]:
    codes = {c.fund_code for c in candidates}
    snapshots = {}
    from ..storage.database import FundDataStore

    for code in codes:
        snapshot = FundDataStore.get_snapshot(code)
        if snapshot:
            snapshots[code] = snapshot
    returns = []
    drawdowns = []
    for holding in holdings:
        snapshot = snapshots.get(holding.fund_code) or {}
        weight = float(holding.weight or 0)
        annualized = _to_float(snapshot.get("annualized_return") or snapshot.get("near_1y"))
        drawdown = _to_float(snapshot.get("max_drawdown"))
        if annualized is not None:
            returns.append((annualized, weight))
        if drawdown is not None:
            drawdowns.append((abs(drawdown), weight))
    return {
        "target_return": _weighted_average(returns),
        "max_drawdown": _weighted_average(drawdowns),
    }


def _xray_from_holdings(holdings: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "asset_weights": {},
        "fund_count": len(holdings),
        "concentration_top3": round(sum(sorted((float(h.get("weight") or 0) for h in holdings), reverse=True)[:3]), 6),
        "estimated_fee": None,
        "overlap_warnings": [],
    }


def _loads(value: str | None, default: Any) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


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
    return round(sum(value * weight for value, weight in values) / total, 4)
