"""专业分析API"""
import re
from fastapi import APIRouter, Query, HTTPException
from typing import List
from ..services.professional_service import professional_analysis, calc_correlation_matrix

router = APIRouter(prefix="/professional", tags=["专业分析"])

FUND_CODE_PATTERN = re.compile(r'^\d{6}$')


def _validate_fund_code(code: str) -> None:
    """校验基金代码格式，防止注入和路径遍历"""
    if not FUND_CODE_PATTERN.match(code):
        raise HTTPException(status_code=400, detail="无效的基金代码格式，应为6位数字")


@router.get("/{code}")
async def fund_professional(code: str):
    """专业分析维度数据"""
    _validate_fund_code(code)
    return professional_analysis(code)


@router.post("/correlation")
async def fund_correlation(codes: List[str] = Query(..., description="基金代码列表")):
    """基金间相关性矩阵"""
    return calc_correlation_matrix(codes)
