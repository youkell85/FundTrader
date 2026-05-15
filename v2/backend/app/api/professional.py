"""专业分析API"""
from fastapi import APIRouter, Query
from typing import List
from ..services.professional_service import professional_analysis, calc_correlation_matrix

router = APIRouter(prefix="/professional", tags=["专业分析"])


@router.get("/{code}")
async def fund_professional(code: str):
    """专业分析维度数据"""
    return professional_analysis(code)


@router.post("/correlation")
async def fund_correlation(codes: List[str] = Query(..., description="基金代码列表")):
    """基金间相关性矩阵"""
    return calc_correlation_matrix(codes)
