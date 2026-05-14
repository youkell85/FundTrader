"""基金排名筛选API"""
from fastapi import APIRouter, Query
from typing import Optional
from ..services.fund_service import get_fund_list

router = APIRouter(prefix="/fund", tags=["基金排名筛选"])


@router.get("/list")
async def fund_list(
    category: str = Query("全部", description="基金类型"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
    sort_by: str = Query("今年来", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    guoyuan_only: bool = Query(True, description="仅国元名单"),
):
    return get_fund_list(category, tag, keyword, sort_by, sort_order, page, page_size, guoyuan_only)


@router.get("/categories")
async def fund_categories():
    from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES
    return {"categories": FUND_CATEGORIES, "types": FUND_TYPES}
