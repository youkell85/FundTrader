"""Explainability Report Generator — structured natural-language explanation of allocation decisions."""
from dataclasses import dataclass, field
from typing import Dict, List, Optional

from .models import AllocationResponse, TAASummary


@dataclass
class ExplainSection:
    """A single section of the explainability report."""
    title: str
    key: str  # e.g. "risk_profile", "saa", "taa", "regime", "risk_factors", "funds"
    summary: str
    details: List[str] = field(default_factory=list)
    icon: str = "info"  # info, warning, success, chart


@dataclass
class ExplainReport:
    """Full explainability report."""
    sections: List[ExplainSection]
    overall_summary: str
    confidence_score: float  # 0-1


def generate_explain_report(response: AllocationResponse) -> ExplainReport:
    """Generate a structured explainability report from an AllocationResponse."""
    sections = []

    # ─── 1. Risk Profile Explanation ───
    sections.append(_explain_risk_profile(response))

    # ─── 2. Regime Explanation ───
    sections.append(_explain_regime(response))

    # ─── 3. SAA Explanation ───
    sections.append(_explain_saa(response))

    # ─── 4. TAA Explanation ───
    sections.append(_explain_taa(response))

    # ─── 5. Risk Factors Explanation ───
    sections.append(_explain_risk_factors(response))

    # ─── 6. Fund Selection Explanation ───
    sections.append(_explain_funds(response))

    # ─── Overall Summary ───
    overall = _build_overall_summary(response, sections)

    # Confidence score based on optimizer level, warnings, etc.
    confidence = _compute_confidence(response)

    return ExplainReport(
        sections=sections,
        overall_summary=overall,
        confidence_score=confidence,
    )


def _explain_risk_profile(response: AllocationResponse) -> ExplainSection:
    """Explain why the user was classified with this risk profile."""
    up = response.user_profile
    details = [
        f"年龄 {up.age} 岁，投资金额 {up.amount:,.0f} 元",
        f"投资期限：{up.horizon}",
    ]

    if up.behavior_adjusted:
        details.append(
            f"根据行为问卷，您的实际风险偏好从「{up.risk_label}」调整为「{up.effective_risk}」"
        )
    else:
        details.append(f"风险偏好：{up.risk_label}（未受行为问卷调整）")

    summary = f"您被识别为「{up.risk_label}」投资者，风险等级为 {up.effective_risk}。"

    return ExplainSection(
        title="风险画像",
        key="risk_profile",
        summary=summary,
        details=details,
        icon="info",
    )


def _explain_regime(response: AllocationResponse) -> ExplainSection:
    """Explain the current market regime and its impact."""
    meta = response.meta
    regime_labels = {
        "goldilocks": "金发女孩（经济温和增长+低通胀）",
        "overheat": "过热（经济强劲+通胀上行）",
        "stagflation": "滞胀（增长放缓+通胀高企）",
        "deflation": "通缩衰退（增长下行+通胀低迷）",
        "baseline": "基准（无明显趋势）",
    }

    regime_desc = regime_labels.get(meta.regime, "基准")
    summary = f"当前市场判定为「{meta.regime_label}」状态：{regime_desc}。"

    details = []
    if meta.taa_skipped:
        details.append("TAA 信号较弱，未进行战术调整")
    if meta.circuit_breaker_triggered:
        details.append("断路器已触发，权益仓位已自动降低以控制风险")

    if not details:
        details.append("市场信号正常，未触发特殊风控措施")

    return ExplainSection(
        title="市场环境",
        key="regime",
        summary=summary,
        details=details,
        icon="chart" if meta.regime != "baseline" else "info",
    )


def _explain_saa(response: AllocationResponse) -> ExplainSection:
    """Explain the strategic asset allocation decisions."""
    saa = response.saa
    ga = saa.group_allocations

    # Find dominant group
    sorted_groups = sorted(ga.items(), key=lambda x: x[1], reverse=True)
    top_group = sorted_groups[0]
    group_labels = {"equity": "权益类", "fixed_income": "固收类", "alternative": "另类", "cash_equiv": "现金类"}

    summary = (
        f"战略配置以{group_labels.get(top_group[0], top_group[0])}为核心（{top_group[1]:.1f}%），"
        f"预期年化收益 {saa.expected_return:.1f}%，波动率 {saa.expected_volatility:.1f}%。"
    )

    details = [
        f"夏普比率：{saa.sharpe_ratio:.2f}",
        f"最大回撤预估：{saa.expected_max_drawdown:.1f}%",
        f"权益中枢：{saa.equity_center:.0f}%",
    ]

    if saa.glide_path_applied:
        details.append("年龄滑道已启用（随年龄增长自动降低权益敞口）")

    # Top 3 individual allocations
    sorted_allocs = sorted(saa.allocations.items(), key=lambda x: x[1], reverse=True)[:3]
    alloc_labels = {
        "a_share_large": "A股大盘", "a_share_small": "A股小盘",
        "a_share_value": "A股价值", "a_share_growth": "A股成长",
        "hk_equity": "港股", "us_equity": "美股",
        "rate_bond": "利率债", "credit_bond": "信用债", "convertible": "可转债",
        "money_fund": "货币基金", "gold": "黄金", "commodity": "商品",
        "reits": "REITs", "cash": "现金",
    }
    top3_str = "、".join(
        f"{alloc_labels.get(a, a)} {v:.1f}%" for a, v in sorted_allocs
    )
    details.append(f"前三大配置：{top3_str}")

    return ExplainSection(
        title="战略配置 (SAA)",
        key="saa",
        summary=summary,
        details=details,
        icon="chart",
    )


def _explain_taa(response: AllocationResponse) -> ExplainSection:
    """Explain tactical adjustments."""
    taa = response.taa
    adjustments = taa.adjustments

    # Check if any meaningful adjustments
    has_adj = any(abs(v) > 0.5 for v in adjustments.values())

    if not has_adj:
        return ExplainSection(
            title="战术调整 (TAA)",
            key="taa",
            summary="当前市场信号较弱，未进行战术偏离调整，保持战略配置不变。",
            details=[f"综合信号得分：{taa.composite_score:.2f}"],
            icon="info",
        )

    # Find top adjustments
    sorted_adj = sorted(adjustments.items(), key=lambda x: abs(x[1]), reverse=True)
    top_adj = [(k, v) for k, v in sorted_adj if abs(v) > 0.5][:3]

    adj_labels = {
        "a_share_large": "A股大盘", "a_share_small": "A股小盘",
        "a_share_value": "A股价值", "a_share_growth": "A股成长",
        "hk_equity": "港股", "us_equity": "美股",
        "rate_bond": "利率债", "credit_bond": "信用债", "convertible": "可转债",
        "money_fund": "货币基金", "gold": "黄金", "commodity": "商品",
        "reits": "REITs", "cash": "现金",
    }

    direction = "超配" if top_adj[0][1] > 0 else "低配"
    summary = f"战术调整综合信号为{direction}信号，主要偏离来自{adj_labels.get(top_adj[0][0], top_adj[0][0])}。"

    details = [f"综合信号得分：{taa.composite_score:.2f}"]
    for asset, adj in top_adj:
        label = adj_labels.get(asset, asset)
        direction = "超配" if adj > 0 else "低配"
        details.append(f"{label}：{direction} {abs(adj):.1f}%")

    # Business cycle
    bc = taa.business_cycle
    details.append(f"经济周期：{bc.phase_name}（推荐风格：{bc.preferred_style}）")

    return ExplainSection(
        title="战术调整 (TAA)",
        key="taa",
        summary=summary,
        details=details,
        icon="chart",
    )


def _explain_risk_factors(response: AllocationResponse) -> ExplainSection:
    """Explain key risk factors and stress test results."""
    details = []

    # Stress tests
    if response.stress_tests:
        worst = max(response.stress_tests, key=lambda s: abs(s.impact))
        details.append(f"最大压力场景：{worst.scenario}（影响 {worst.impact:.1f}%，最大亏损 ¥{worst.max_loss:,.0f}）")

    # Monte Carlo
    if response.monte_carlo:
        mc = response.monte_carlo
        details.append(f"蒙特卡洛模拟：中位收益 {mc.median_return:.1f}%，正收益概率 {mc.prob_positive:.0f}%")
        details.append(f"95% VaR：{mc.var_95:.1f}%，CVaR：{mc.cvar_95:.1f}%")

    # Factor exposures
    if response.factor_exposures:
        top_factors = sorted(
            response.factor_exposures.items(),
            key=lambda x: abs(x[1]), reverse=True,
        )[:3]
        factor_str = "、".join(f"{k}({v:+.2f})" for k, v in top_factors)
        details.append(f"主要因子暴露：{factor_str}")

    summary = "综合压力测试和蒙特卡洛模拟，评估极端场景下的组合表现。"

    return ExplainSection(
        title="风险因子",
        key="risk_factors",
        summary=summary,
        details=details,
        icon="warning",
    )


def _explain_funds(response: AllocationResponse) -> ExplainSection:
    """Explain fund selection rationale."""
    funds = response.funds
    if not funds:
        return ExplainSection(
            title="基金选择",
            key="funds",
            summary="当前未能匹配到合适的基金，请检查基金池配置。",
            details=[],
            icon="warning",
        )

    # Top 3 funds by weight
    sorted_funds = sorted(funds, key=lambda f: f.weight, reverse=True)[:3]
    details = []
    for f in sorted_funds:
        details.append(f"{f.name}（{f.code}）：{f.weight:.1f}%，评分 {f.score:.1f}，理由：{f.reason}")

    summary = f"共选出 {len(funds)} 只基金覆盖 {response.portfolio_metrics.get('fund_count', len(funds))} 个资产类别。"

    return ExplainSection(
        title="基金选择",
        key="funds",
        summary=summary,
        details=details,
        icon="success",
    )


def _build_overall_summary(response: AllocationResponse, sections: List[ExplainSection]) -> str:
    """Build overall summary from all sections."""
    up = response.user_profile
    saa = response.saa
    pm = response.portfolio_metrics

    parts = [
        f"基于您的{up.risk_label}风险画像，",
        f"系统为您生成了预期收益 {pm.get('expected_return', 0):.1f}%、",
        f"波动率 {pm.get('volatility', 0):.1f}% 的配置方案。",
    ]

    if response.meta.circuit_breaker_triggered:
        parts.append("注意：断路器已触发，权益仓位已降低。")

    if response.warnings:
        parts.append(f"共有 {len(response.warnings)} 条风险提示。")

    return "".join(parts)


def _compute_confidence(response: AllocationResponse) -> float:
    """Compute overall confidence score (0-1)."""
    score = 0.8  # Base confidence

    # Penalize for warnings
    score -= len(response.warnings) * 0.05

    # Penalize for circuit breaker
    if response.meta.circuit_breaker_triggered:
        score -= 0.1

    # Penalize for baseline regime (less informative)
    if response.meta.regime == "baseline":
        score -= 0.05

    # Bonus for TAA adjustments (more informed)
    if not response.meta.taa_skipped:
        score += 0.05

    # Bonus for good Sharpe
    if response.saa.sharpe_ratio > 0.5:
        score += 0.05

    return max(0.0, min(1.0, round(score, 2)))
