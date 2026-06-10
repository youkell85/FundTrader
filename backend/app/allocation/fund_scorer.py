"""
Fund Scorer — 多维度基金评分引擎

对每个资产类别的候选基金进行5维度评分:
1. 跟踪质量 (Tracking Quality)   — 跟踪误差、信息比率
2. 流动性 (Liquidity)            — 日均成交额、规模
3. 费率成本 (Cost)               — 管理费+托管费年化
4. 规模稳定性 (Scale Stability)  — 基金规模、份额变化趋势
5. 长期绩效 (Performance)        — 近1年收益、夏普比率
"""
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


@dataclass
class FundProfile:
    """基金的基础资料和评分因子"""
    code: str
    name: str
    fund_type: str
    asset_class: str
    company: str = ""              # 基金公司
    # 费率
    management_fee: float = 0.005  # 年管理费率
    custody_fee: float = 0.001    # 年托管费率
    # 规模 (亿元)
    aum: float = 10.0
    # 日均成交额 (万元)
    daily_turnover: float = 5000.0
    # 跟踪误差 (年化)
    tracking_error: float = 0.02
    # 近1年收益
    return_1y: float = 0.0
    # 夏普比率
    sharpe_1y: float = 0.0
    # 基础质量分 (人工赋分)
    base_quality: float = 85.0
    metadata_status: str = "assumption"
    metadata_source: str = "static_fund_pool"
    metadata_as_of: Optional[str] = None
    stale_days: Optional[int] = None


@dataclass
class FundScore:
    """单只基金的多维度评分结果"""
    code: str
    name: str
    fund_type: str
    asset_class: str
    company: str = ""
    # 五维度归一化分 (0-100)
    tracking_score: float = 0.0
    liquidity_score: float = 0.0
    cost_score: float = 0.0
    scale_score: float = 0.0
    performance_score: float = 0.0
    # 加权总分
    total_score: float = 0.0
    # 排名
    rank: int = 0
    # 是否当前推荐
    is_recommended: bool = False
    # 评分理由
    reasons: List[str] = field(default_factory=list)
    metadata_status: str = "assumption"
    metadata_source: str = "static_fund_pool"
    metadata_as_of: Optional[str] = None
    stale_days: Optional[int] = None


# 五维度权重 — 针对被动指数基金/ETF的最优权重
DIMENSION_WEIGHTS = {
    "tracking": 0.25,    # 跟踪质量最重要
    "liquidity": 0.20,   # 流动性关乎交易执行
    "cost": 0.25,        # 费率直接影响长期收益
    "scale": 0.15,       # 规模影响清盘风险
    "performance": 0.15, # 近期绩效作参考
}


def score_fund(profile: FundProfile, peers: List[FundProfile]) -> FundScore:
    """
    对单只基金评分。相对于同资产类别的同类基金进行归一化。
    """
    result = FundScore(
        code=profile.code,
        name=profile.name,
        fund_type=profile.fund_type,
        asset_class=profile.asset_class,
        company=profile.company,
        metadata_status=profile.metadata_status,
        metadata_source=profile.metadata_source,
        metadata_as_of=profile.metadata_as_of,
        stale_days=profile.stale_days,
    )

    # 1. 跟踪质量 — 跟踪误差越小越好
    te_values = [p.tracking_error for p in peers]
    result.tracking_score = _score_lower_better(profile.tracking_error, te_values)
    if result.tracking_score >= 80:
        result.reasons.append("跟踪误差极低")

    # 2. 流动性 — 日均成交额越大越好
    turnover_values = [p.daily_turnover for p in peers]
    result.liquidity_score = _score_higher_better(profile.daily_turnover, turnover_values)
    if result.liquidity_score >= 80:
        result.reasons.append("流动性充裕")

    # 3. 费率 — 总费率越低越好
    total_fee = profile.management_fee + profile.custody_fee
    fee_values = [p.management_fee + p.custody_fee for p in peers]
    result.cost_score = _score_lower_better(total_fee, fee_values)
    if result.cost_score >= 80:
        result.reasons.append("费率低廉")

    # 4. 规模 — 越大越好，但有上限效应
    aum_values = [p.aum for p in peers]
    result.scale_score = _score_higher_better(profile.aum, aum_values, cap=500)
    if profile.aum < 2.0:
        result.scale_score = max(0, result.scale_score - 20)
        result.reasons.append("规模偏小需关注")

    # 5. 绩效 — 夏普比率越高越好
    sharpe_values = [p.sharpe_1y for p in peers]
    result.performance_score = _score_higher_better(profile.sharpe_1y, sharpe_values)

    # 加权总分
    result.total_score = round(
        result.tracking_score * DIMENSION_WEIGHTS["tracking"]
        + result.liquidity_score * DIMENSION_WEIGHTS["liquidity"]
        + result.cost_score * DIMENSION_WEIGHTS["cost"]
        + result.scale_score * DIMENSION_WEIGHTS["scale"]
        + result.performance_score * DIMENSION_WEIGHTS["performance"],
        1
    )

    return result


def rank_funds_for_asset_class(
    profiles: List[FundProfile],
    preferred_tags: Optional[List[str]] = None,
) -> List[FundScore]:
    """
    对同一资产类别的所有候选基金进行评分和排序。
    返回按总分降序排列的评分列表。
    """
    if not profiles:
        return []

    # 评分
    scores = [score_fund(p, profiles) for p in profiles]

    # 偏好加分
    if preferred_tags:
        for s in scores:
            if _matches_tag(s.asset_class, preferred_tags):
                s.total_score += 2.0
                s.reasons.append("用户偏好匹配")

    # 排序
    scores.sort(key=lambda x: x.total_score, reverse=True)

    # 赋排名、标记推荐
    for i, s in enumerate(scores):
        s.rank = i + 1
        s.is_recommended = (i == 0)

    return scores


def _score_lower_better(value: float, peers: List[float], floor: float = 0.0) -> float:
    """值越低分数越高。归一化到 0-100。"""
    if not peers or len(peers) < 2:
        return 75.0
    min_v = min(peers)
    max_v = max(peers)
    if max_v <= min_v:
        return 80.0
    # 归一化: 最小值得100, 最大值得20
    ratio = (max_v - value) / (max_v - min_v)
    return round(max(0, min(100, 20 + ratio * 80)), 1)


def _score_higher_better(value: float, peers: List[float], cap: Optional[float] = None) -> float:
    """值越高分数越高。归一化到 0-100。"""
    if not peers or len(peers) < 2:
        return 75.0
    effective_peers = peers
    effective_value = value
    if cap is not None:
        effective_peers = [min(p, cap) for p in peers]
        effective_value = min(value, cap)
    min_v = min(effective_peers)
    max_v = max(effective_peers)
    if max_v <= min_v:
        return 80.0
    ratio = (effective_value - min_v) / (max_v - min_v)
    return round(max(0, min(100, 20 + ratio * 80)), 1)


def _matches_tag(asset_class: str, tags: List[str]) -> bool:
    """检查资产类别是否匹配用户偏好标签"""
    tag_map = {
        "gold": ["gold"],
        "qdii": ["us_equity", "hk_equity"],
        "hk_connect": ["hk_equity"],
        "reits": ["reits"],
        "commodity": ["commodity"],
        "convertible": ["convertible"],
    }
    for tag in tags:
        if asset_class in tag_map.get(tag, []):
            return True
    return False
