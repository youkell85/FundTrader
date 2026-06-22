from __future__ import annotations

from ..allocation.models import SuitabilityResultModel


RISK_ORDER = {
    "conservative": 1,
    "moderate": 2,
    "steady": 2,
    "balanced": 3,
    "aggressive": 4,
    "radical": 5,
}


def check_suitability(client_risk_level: str | None, product_risk_level: str | None) -> SuitabilityResultModel:
    if not client_risk_level or not product_risk_level:
        return SuitabilityResultModel(
            decision="review_required",
            reasons=["客户或产品风险等级缺失，需人工复核。"],
            required_disclosures=["补充客户风险等级和产品风险等级后再生成推荐话术。"],
        )

    client = RISK_ORDER.get(client_risk_level)
    product = RISK_ORDER.get(product_risk_level)
    if client is None or product is None:
        return SuitabilityResultModel(
            decision="review_required",
            reasons=[f"未知风险等级：client={client_risk_level}, product={product_risk_level}。"],
            required_disclosures=["确认风险等级枚举后再生成推荐话术。"],
        )

    delta = product - client
    if delta <= 0:
        return SuitabilityResultModel(
            decision="approved",
            reasons=[f"客户风险等级 {client_risk_level} 可覆盖产品风险等级 {product_risk_level}。"],
            required_disclosures=["市场有风险，投资需谨慎。"],
        )
    if delta == 1:
        return SuitabilityResultModel(
            decision="review_required",
            reasons=[f"产品风险等级 {product_risk_level} 高于客户风险等级 {client_risk_level} 1 级。"],
            required_disclosures=["需补充风险揭示并经人工复核后方可推荐。"],
        )
    return SuitabilityResultModel(
        decision="rejected",
        reasons=[f"产品风险等级 {product_risk_level} 高于客户风险等级 {client_risk_level} {delta} 级，禁止推荐。"],
        required_disclosures=["建议更换与客户风险承受能力匹配的产品。"],
    )
