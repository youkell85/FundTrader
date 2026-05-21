"""深度产品分析API"""
import re
from fastapi import APIRouter, HTTPException
from typing import List, Dict, Any
from concurrent.futures import ThreadPoolExecutor, as_completed
import math
from ..services.analysis_service import analyze_fund
from ..services.llm_service import analyze_manager_style, analyze_fund_comprehensive, analyze_dca_strategy
from ..data.cache_manager import cache
from ..config import CACHE_TTL_INFO

router = APIRouter(prefix="/analysis", tags=["深度产品分析"])

# 基金代码格式：6位数字（公募基金标准格式）
FUND_CODE_PATTERN = re.compile(r'^\d{6}$')


def _validate_fund_code(code: str) -> None:
    """校验基金代码格式，防止注入和路径遍历"""
    if not FUND_CODE_PATTERN.match(code):
        raise HTTPException(status_code=400, detail="无效的基金代码格式，应为6位数字")


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


def _fill_missing_holding_changes(data: Dict[str, Any]) -> Dict[str, Any]:
    holdings = data.get("holdings") if data else None
    if not holdings or not isinstance(holdings, list):
        return data
    if all(item.get("daily_change") is not None for item in holdings if isinstance(item, dict)):
        return data
    try:
        from ..data.akshare_fetcher import get_stock_daily_changes
        codes = [item.get("code", "") for item in holdings if isinstance(item, dict)]
        changes = get_stock_daily_changes(codes)
        if changes:
            data = dict(data)
            data["holdings"] = [
                {**item, "daily_change": changes.get(item.get("code", ""), item.get("daily_change"))}
                if isinstance(item, dict) else item
                for item in holdings
            ]
    except Exception:
        pass
    return data


def cached_analyze_fund(code: str) -> Dict[str, Any]:
    cache_key = f"analysis_full_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO)
    if cached:
        cached = _fill_missing_fees(code, cached)
        cached = _fill_missing_holding_changes(cached)
        cache.set(cache_key, cached)
        return cached
    result = analyze_fund(code)
    if result and not result.get("error"):
        result = _fill_missing_fees(code, result)
        result = _fill_missing_holding_changes(result)
        cache.set(cache_key, result)
    return result


def _to_float(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace("%", ""))
        return number if math.isfinite(number) else None
    except Exception:
        return None


def _calc_nav_risk_metrics(nav_data: List[Dict[str, Any]]) -> Dict[str, float | None]:
    points = []
    for item in nav_data or []:
        nav = _to_float(item.get("accum_nav") if item.get("accum_nav") not in (None, "", 0) else item.get("nav"))
        if nav is not None and nav > 0:
            points.append(nav)
    if len(points) < 2:
        return {"sharpeRatio": None, "maxDrawdown": None}

    daily_returns = []
    peak = points[0]
    max_drawdown = 0.0
    for index, nav in enumerate(points):
        if index > 0 and points[index - 1] > 0:
            daily_returns.append((nav - points[index - 1]) / points[index - 1])
        peak = max(peak, nav)
        if peak > 0:
            max_drawdown = min(max_drawdown, (nav - peak) / peak * 100)

    sharpe_ratio = None
    if len(daily_returns) > 1:
        mean = sum(daily_returns) / len(daily_returns)
        variance = sum((item - mean) ** 2 for item in daily_returns) / (len(daily_returns) - 1)
        volatility = math.sqrt(variance) * math.sqrt(252)
        if volatility > 0:
            sharpe_ratio = round((mean * 252) / volatility, 2)

    return {
        "sharpeRatio": sharpe_ratio,
        "maxDrawdown": round(max_drawdown, 2),
    }


@router.get("/{code}")
async def fund_analysis(code: str):
    """获取基金深度分析"""
    _validate_fund_code(code)
    result = cached_analyze_fund(code)
    return result


@router.post("/batch")
async def fund_analysis_batch(codes: List[str]) -> Dict[str, Any]:
    """批量获取基金深度分析（并行处理，用于首页列表一次性加载）"""
    for code in codes:
        _validate_fund_code(code)
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
    _validate_fund_code(code)
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
    cache_key = f"llm_review_v2_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO * 6)  # 12小时缓存 LLM 评价
    if cached:
        return cached
    fund_data = cached_analyze_fund(code)
    nav_metrics = _calc_nav_risk_metrics(fund_data.get("nav_data") or [])
    perf = {
        "return1y": fund_data.get("return1y"),
        "return3y": fund_data.get("return3y"),
        "return5y": fund_data.get("return5y"),
        "annualizedReturn": fund_data.get("annualized_return"),
        "sharpeRatio": nav_metrics.get("sharpeRatio"),
        "maxDrawdown": nav_metrics.get("maxDrawdown"),
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

