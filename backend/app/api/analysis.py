"""深度产品分析API"""
from fastapi import APIRouter
from ..services.analysis_service import analyze_fund
from ..services.llm_service import analyze_manager_style

router = APIRouter(prefix="/analysis", tags=["深度产品分析"])


@router.get("/{code}")
async def fund_analysis(code: str):
    """获取基金深度分析"""
    result = analyze_fund(code)
    return result


@router.get("/{code}/style")
async def manager_style_analysis(code: str):
    """LLM分析基金经理投资风格"""
    from ..services.analysis_service import analyze_fund
    fund_data = analyze_fund(code)
    manager = fund_data.get("manager")
    if not manager:
        return {"error": "未找到基金经理信息"}

    style = analyze_manager_style(
        manager_name=manager.get("name", "未知"),
        fund_code=code,
        fund_name=fund_data.get("name", code),
        performance_data=str(fund_data.get("nav_data", [])[-20:]),
        holdings_data=str(fund_data.get("holdings", [])[:5]),
    )

    return {"code": code, "style_analysis": style}
