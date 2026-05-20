"""深度产品分析API"""
from fastapi import APIRouter
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
from ..services.analysis_service import analyze_fund
from ..services.llm_service import analyze_manager_style, analyze_fund_comprehensive, analyze_dca_strategy
from ..data.cache_manager import cache
from ..config import CACHE_TTL_INFO

router = APIRouter(prefix="/analysis", tags=["深度产品分析"])


def _fill_missing_fees(code: str, data: Dict[str, Any]) -> Dict[str, Any]:
    if not data or (data.get("feeManage") is not None and data.get("feeCustody") is not None):
        return data
    try:
        from ..data.efinance_fetcher import get_fund_fees
        fees = get_fund_fees(code)
        if fees:
            data = dict(data)
            if data.get("feeManage") is None:
                data["feeManage"] = fees.get("feeManage")
            if data.get("feeCustody") is None:
                data["feeCustody"] = fees.get("feeCustody")
    except Exception:
        pass
    return data


def cached_analyze_fund(code: str) -> Dict[str, Any]:
    cache_key = f"analysis_full_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO)
    if cached:
        cached = _fill_missing_fees(code, cached)
        cache.set(cache_key, cached)
        return cached
    result = analyze_fund(code)
    if result and not result.get("error"):
        result = _fill_missing_fees(code, result)
        cache.set(cache_key, result)
    return result


@router.get("/{code}")
async def fund_analysis(code: str):
    """获取基金深度分析"""
    result = cached_analyze_fund(code)
    return result


@router.post("/batch")
async def fund_analysis_batch(codes: List[str]) -> Dict[str, Any]:
    """批量获取基金深度分析（并行处理，用于首页列表一次性加载）"""
    results = {}
    # 使用线程池并行处理（analyze_fund 主要是IO密集型：网络请求+文件缓存）
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_code = {
            executor.submit(cached_analyze_fund, code): code
            for code in set(codes)  # 去重
        }
        for future in as_completed(future_to_code):
            code = future_to_code[future]
            try:
                results[code] = future.result()
            except Exception as e:
                results[code] = {"code": code, "error": str(e)}
    return {"results": results}


@router.get("/{code}/style")
async def manager_style_analysis(code: str):
    """LLM分析基金经理投资风格"""
    fund_data = cached_analyze_fund(code)
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


@router.get("/{code}/llm_review")
async def fund_llm_review(code: str):
    """LLM 全面点评基金业绩与经理（含多个维度）。带后端文件缓存。"""
    cache_key = f"llm_review_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO * 6)  # 12小时缓存 LLM 评价
    if cached:
        return cached
    fund_data = cached_analyze_fund(code)
    perf = {
        "return1y": fund_data.get("return1y"),
        "return3y": fund_data.get("return3y"),
        "return5y": fund_data.get("return5y"),
        "annualizedReturn": fund_data.get("annualized_return"),
        "sharpeRatio": (fund_data.get("radar_scores", {}) or {}).get("stock_picking"),
        "maxDrawdown": (fund_data.get("radar_scores", {}) or {}).get("risk_control"),
    }
    review = analyze_fund_comprehensive(
        fund_code=code,
        fund_name=fund_data.get("name", code),
        perf_data=perf,
        manager_data=fund_data.get("manager") or {},
        holdings_data=fund_data.get("holdings") or [],
    )
    payload = {"code": code, "review": review or {"raw": "LLM 服务未配置或调用失败"}}
    if review:
        cache.set(cache_key, payload)
    return payload

