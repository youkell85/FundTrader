"""智能推荐API"""
from fastapi import APIRouter
from ..models.analysis import RecommendRequest
from ..services.recommend_service import generate_recommendation
from ..services.llm_service import generate_recommendation_analysis

router = APIRouter(prefix="/recommend", tags=["智能推荐"])


@router.post("")
async def recommend(request: RecommendRequest):
    """生成智能推荐方案"""
    result = generate_recommendation(
        risk_level=request.risk_level,
        investment_horizon=request.investment_horizon,
        amount=request.amount,
        preferences=request.preferences,
    )

    # LLM增强分析
    if result.get("funds"):
        llm_summary = await generate_recommendation_analysis(
            risk_level=request.risk_level,
            funds=result["funds"],
            market_summary=str(result.get("market_overview", "")),
        )
        if llm_summary:
            result["llm_analysis"] = llm_summary

    return result


@router.get("/market")
async def market_overview():
    """市场行情概览"""
    from ..data.akshare_fetcher import get_market_index, get_fund_industry_board
    from ..data.cache_manager import cache
    def load_non_empty_list(key, fetcher):
        cached = cache.get(key, 1800)
        if isinstance(cached, list) and cached:
            return cached
        value = fetcher()
        if isinstance(value, list) and value:
            cache.set(key, value)
            return value
        return value if isinstance(value, list) else []

    market = load_non_empty_list("market_index", get_market_index)
    industries = load_non_empty_list("industry_board", get_fund_industry_board)
    return {"market": market, "industries": industries}
