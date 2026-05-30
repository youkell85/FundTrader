"""Fund Mapper — map allocation weights to real fund codes using multi-dimensional scoring."""
import logging
from typing import Dict, List, Optional

from .config import ASSET_CLASSES, ASSET_TO_GROUP, FUND_ASSET_MAP
from .models import FundItem
from .fund_scorer import FundProfile, FundScore, rank_funds_for_asset_class
from .fund_data_refresher import refresh_fund_profile

logger = logging.getLogger(__name__)

# ─── 扩展基金池: 每个资产类别 3-5 只候选基金 ───
# 包含静态元数据：费率、规模、流动性、跟踪误差等
_FUND_POOL: Dict[str, FundProfile] = {
    # ═══ A股大盘 ═══
    "510300": FundProfile(code="510300", name="华泰柏瑞沪深300ETF", fund_type="指数型-股票",
        asset_class="a_share_large", management_fee=0.005, custody_fee=0.001,
        aum=680.0, daily_turnover=150000.0, tracking_error=0.012, base_quality=95),
    "510050": FundProfile(code="510050", name="华夏上证50ETF", fund_type="指数型-股票",
        asset_class="a_share_large", management_fee=0.005, custody_fee=0.001,
        aum=450.0, daily_turnover=80000.0, tracking_error=0.015, base_quality=93),
    "159919": FundProfile(code="159919", name="嘉实沪深300ETF", fund_type="指数型-股票",
        asset_class="a_share_large", management_fee=0.005, custody_fee=0.001,
        aum=120.0, daily_turnover=35000.0, tracking_error=0.014, base_quality=90),

    # ═══ A股小盘 ═══
    "512100": FundProfile(code="512100", name="南方中证1000ETF", fund_type="指数型-股票",
        asset_class="a_share_small", management_fee=0.005, custody_fee=0.001,
        aum=95.0, daily_turnover=45000.0, tracking_error=0.018, base_quality=88),
    "159915": FundProfile(code="159915", name="易方达创业板ETF", fund_type="指数型-股票",
        asset_class="a_share_small", management_fee=0.005, custody_fee=0.001,
        aum=280.0, daily_turnover=120000.0, tracking_error=0.015, base_quality=90),
    "159949": FundProfile(code="159949", name="华安创业板50ETF", fund_type="指数型-股票",
        asset_class="a_share_small", management_fee=0.005, custody_fee=0.001,
        aum=55.0, daily_turnover=25000.0, tracking_error=0.020, base_quality=85),

    # ═══ A股价值 ═══
    "515180": FundProfile(code="515180", name="易方达中证红利ETF", fund_type="指数型-股票",
        asset_class="a_share_value", management_fee=0.005, custody_fee=0.001,
        aum=85.0, daily_turnover=30000.0, tracking_error=0.016, base_quality=89),
    "510880": FundProfile(code="510880", name="华泰柏瑞红利ETF", fund_type="指数型-股票",
        asset_class="a_share_value", management_fee=0.005, custody_fee=0.001,
        aum=125.0, daily_turnover=42000.0, tracking_error=0.015, base_quality=90),
    "512380": FundProfile(code="512380", name="中证100ETF", fund_type="指数型-股票",
        asset_class="a_share_value", management_fee=0.005, custody_fee=0.001,
        aum=35.0, daily_turnover=12000.0, tracking_error=0.018, base_quality=83),

    # ═══ A股成长 ═══
    "159995": FundProfile(code="159995", name="华夏芯片ETF", fund_type="指数型-股票",
        asset_class="a_share_growth", management_fee=0.005, custody_fee=0.001,
        aum=180.0, daily_turnover=85000.0, tracking_error=0.020, base_quality=86),
    "515050": FundProfile(code="515050", name="华夏中证5G通信ETF", fund_type="指数型-股票",
        asset_class="a_share_growth", management_fee=0.005, custody_fee=0.001,
        aum=55.0, daily_turnover=18000.0, tracking_error=0.022, base_quality=82),
    "512760": FundProfile(code="512760", name="国泰半导体ETF", fund_type="指数型-股票",
        asset_class="a_share_growth", management_fee=0.005, custody_fee=0.001,
        aum=120.0, daily_turnover=65000.0, tracking_error=0.021, base_quality=84),

    # ═══ 港股 ═══
    "513050": FundProfile(code="513050", name="易方达中证港股通50ETF", fund_type="指数型-股票",
        asset_class="hk_equity", management_fee=0.006, custody_fee=0.001,
        aum=65.0, daily_turnover=28000.0, tracking_error=0.018, base_quality=87),
    "159920": FundProfile(code="159920", name="华夏恒生ETF", fund_type="QDII-指数",
        asset_class="hk_equity", management_fee=0.006, custody_fee=0.0015,
        aum=90.0, daily_turnover=35000.0, tracking_error=0.020, base_quality=86),
    "513060": FundProfile(code="513060", name="华安恒生科技ETF", fund_type="QDII-指数",
        asset_class="hk_equity", management_fee=0.006, custody_fee=0.0015,
        aum=75.0, daily_turnover=55000.0, tracking_error=0.022, base_quality=84),

    # ═══ 美股QDII ═══
    "513500": FundProfile(code="513500", name="博时标普500ETF", fund_type="QDII-指数",
        asset_class="us_equity", management_fee=0.006, custody_fee=0.0015,
        aum=110.0, daily_turnover=48000.0, tracking_error=0.015, base_quality=91),
    "513100": FundProfile(code="513100", name="国泰纳斯达克100ETF", fund_type="QDII-指数",
        asset_class="us_equity", management_fee=0.006, custody_fee=0.0015,
        aum=85.0, daily_turnover=55000.0, tracking_error=0.016, base_quality=90),
    "160213": FundProfile(code="160213", name="国泰纳指100联接", fund_type="QDII-指数",
        asset_class="us_equity", management_fee=0.008, custody_fee=0.002,
        aum=45.0, daily_turnover=8000.0, tracking_error=0.020, base_quality=85),

    # ═══ 利率债 ═══
    "511010": FundProfile(code="511010", name="国泰上证5年期国债ETF", fund_type="债券型-长期纯债",
        asset_class="rate_bond", management_fee=0.003, custody_fee=0.001,
        aum=48.0, daily_turnover=15000.0, tracking_error=0.008, base_quality=92),
    "511260": FundProfile(code="511260", name="国泰上证10年期国债ETF", fund_type="债券型-长期纯债",
        asset_class="rate_bond", management_fee=0.003, custody_fee=0.001,
        aum=32.0, daily_turnover=12000.0, tracking_error=0.010, base_quality=90),

    # ═══ 信用债 ═══
    "511030": FundProfile(code="511030", name="平安中高等级公司债ETF", fund_type="债券型-中短债",
        asset_class="credit_bond", management_fee=0.003, custody_fee=0.001,
        aum=35.0, daily_turnover=8000.0, tracking_error=0.010, base_quality=88),
    "511020": FundProfile(code="511020", name="平安中期国债ETF", fund_type="债券型-中短债",
        asset_class="credit_bond", management_fee=0.003, custody_fee=0.001,
        aum=22.0, daily_turnover=5000.0, tracking_error=0.012, base_quality=86),

    # ═══ 可转债 ═══
    "511380": FundProfile(code="511380", name="博时可转债ETF", fund_type="债券型-可转债",
        asset_class="convertible", management_fee=0.004, custody_fee=0.001,
        aum=18.0, daily_turnover=12000.0, tracking_error=0.025, base_quality=85),
    "123120": FundProfile(code="123120", name="中证转债ETF", fund_type="债券型-可转债",
        asset_class="convertible", management_fee=0.004, custody_fee=0.001,
        aum=12.0, daily_turnover=8000.0, tracking_error=0.028, base_quality=83),

    # ═══ 货币基金 ═══
    "511880": FundProfile(code="511880", name="银华日利ETF", fund_type="货币型",
        asset_class="money_fund", management_fee=0.003, custody_fee=0.0008,
        aum=680.0, daily_turnover=250000.0, tracking_error=0.001, base_quality=94),
    "000198": FundProfile(code="000198", name="天弘余额宝货币", fund_type="货币型",
        asset_class="money_fund", management_fee=0.003, custody_fee=0.0008,
        aum=7500.0, daily_turnover=500000.0, tracking_error=0.001, base_quality=93),
    "003003": FundProfile(code="003003", name="华夏现金增利", fund_type="货币型",
        asset_class="money_fund", management_fee=0.003, custody_fee=0.0008,
        aum=350.0, daily_turnover=100000.0, tracking_error=0.001, base_quality=91),

    # ═══ 黄金 ═══
    "518880": FundProfile(code="518880", name="华安黄金ETF", fund_type="商品型-贵金属",
        asset_class="gold", management_fee=0.005, custody_fee=0.001,
        aum=180.0, daily_turnover=95000.0, tracking_error=0.008, base_quality=93),
    "159934": FundProfile(code="159934", name="易方达黄金ETF", fund_type="商品型-贵金属",
        asset_class="gold", management_fee=0.005, custody_fee=0.001,
        aum=85.0, daily_turnover=42000.0, tracking_error=0.009, base_quality=91),

    # ═══ 商品 ═══
    "161815": FundProfile(code="161815", name="银华抗通胀主题", fund_type="QDII-商品",
        asset_class="commodity", management_fee=0.010, custody_fee=0.002,
        aum=8.0, daily_turnover=2500.0, tracking_error=0.035, base_quality=76),
    "165513": FundProfile(code="165513", name="信诚商品ETF联接", fund_type="QDII-商品",
        asset_class="commodity", management_fee=0.010, custody_fee=0.002,
        aum=5.0, daily_turnover=1500.0, tracking_error=0.038, base_quality=74),

    # ═══ REITs ═══
    "508000": FundProfile(code="508000", name="华安张江光大REIT", fund_type="REITs",
        asset_class="reits", management_fee=0.003, custody_fee=0.001,
        aum=15.0, daily_turnover=5000.0, tracking_error=0.030, base_quality=83),
    "508027": FundProfile(code="508027", name="东吴苏园产业REIT", fund_type="REITs",
        asset_class="reits", management_fee=0.003, custody_fee=0.001,
        aum=12.0, daily_turnover=3500.0, tracking_error=0.032, base_quality=80),
    "180101": FundProfile(code="180101", name="银华中证基建ETF", fund_type="指数型-股票",
        asset_class="reits", management_fee=0.005, custody_fee=0.001,
        aum=8.0, daily_turnover=4000.0, tracking_error=0.025, base_quality=78),
}

# Role assignment logic
_ROLE_MAP = {
    "equity": "权益核心",
    "fixed_income": "防守底仓",
    "alternative": "分散卫星",
    "cash_equiv": "流动性储备",
}


def map_funds(
    allocations: Dict[str, float],
    amount: float,
    preferred_tags: List[str],
) -> List[FundItem]:
    """Map allocation weights to specific fund selections using multi-dimensional scoring.

    For each asset class with weight > 0:
    1. Collect candidate FundProfiles
    2. Run 5-dimension scoring and ranking
    3. Select top-ranked fund
    """
    funds: List[FundItem] = []

    for asset_class in ASSET_CLASSES:
        weight = allocations.get(asset_class, 0.0)
        if weight < 0.005:
            continue

        # Get scored ranking for this asset class
        ranked = get_ranked_for_class(asset_class, preferred_tags)
        if not ranked:
            continue

        # Select top-ranked fund
        best = ranked[0]
        fund_amount = round(amount * weight, 2)
        group = ASSET_TO_GROUP.get(asset_class, "equity")
        role = _ROLE_MAP.get(group, "分散卫星")

        # Build reason from scoring insights
        reason = f"综合评分{best.total_score:.0f}"
        if best.reasons:
            reason += "，" + "、".join(best.reasons[:2])

        funds.append(FundItem(
            code=best.code,
            name=best.name,
            type=best.fund_type,
            asset_class=asset_class,
            weight=round(weight, 4),
            amount=fund_amount,
            role=role,
            reason=reason,
            score=best.total_score,
        ))

    return funds


def get_ranked_for_class(
    asset_class: str,
    preferred_tags: Optional[List[str]] = None,
) -> List[FundScore]:
    """Get ranked fund list for a specific asset class.

    Dynamically refreshes fund metrics from real NAV data before scoring.
    Falls back to static metadata if refresh fails.
    """
    profiles = [p for p in _FUND_POOL.values() if p.asset_class == asset_class]
    if not profiles:
        return []

    # Dynamic refresh: update metrics from real NAV data
    refreshed = []
    for p in profiles:
        try:
            refreshed.append(refresh_fund_profile(p))
        except Exception as e:
            logger.debug(f"Dynamic refresh failed for {p.code}, using static: {e}")
            refreshed.append(p)

    return rank_funds_for_asset_class(refreshed, preferred_tags)


def get_all_rankings(preferred_tags: Optional[List[str]] = None) -> Dict[str, List[FundScore]]:
    """Get rankings for all 14 asset classes. Used by the ranking API."""
    result: Dict[str, List[FundScore]] = {}
    for asset_class in ASSET_CLASSES:
        ranked = get_ranked_for_class(asset_class, preferred_tags)
        if ranked:
            result[asset_class] = ranked
    return result
