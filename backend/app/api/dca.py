"""定投回测API"""
from fastapi import APIRouter
from ..models.analysis import DcaBacktestRequest
from ..services.dca_service import run_dca_backtest, get_dca_suggestion

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
