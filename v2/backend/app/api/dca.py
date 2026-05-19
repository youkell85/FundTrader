"""定投回测API"""
from fastapi import APIRouter
from ..models.analysis import DcaBacktestRequest
from ..services.dca_service import run_dca_backtest, get_dca_suggestion
from ..services.llm_service import analyze_dca_strategy
from ..data.cache_manager import cache
from ..config import CACHE_TTL_INFO

router = APIRouter(prefix="/dca", tags=["定投回测"])


@router.post("/backtest")
async def dca_backtest(request: DcaBacktestRequest):
    """执行定投回测"""
    return run_dca_backtest(
        codes=request.codes,
        amount=request.amount,
        frequency=request.frequency,
        strategy=request.strategy,
        start_date=request.start_date or "",
        end_date=request.end_date or "",
    )


@router.get("/suggestion/{code}")
async def dca_suggestion(code: str):
    """获取定投建议"""
    return get_dca_suggestion(code)


@router.post("/llm_review")
async def dca_llm_review(payload: dict):
    """对定投回测结果调用 LLM 生成专业评价。
    请求体：{ code, name, dca: {total_invested, final_value, total_return, annualized_return, max_drawdown}, benchmark: {total_invested, final_value, profit_rate} }"""
    code = payload.get("code", "")
    name = payload.get("name", code)
    dca_metrics = payload.get("dca") or {}
    bench = payload.get("benchmark") or {}
    cache_key = f"dca_llm_{code}_{dca_metrics.get('total_invested')}_{dca_metrics.get('final_value')}"
    cached = cache.get(cache_key, CACHE_TTL_INFO * 6)
    if cached:
        return cached
    review = analyze_dca_strategy(code, name, dca_metrics, bench)
    out = {"code": code, "review": review or {"raw": "LLM 服务未配置或调用失败"}}
    if review:
        cache.set(cache_key, out)
    return out

