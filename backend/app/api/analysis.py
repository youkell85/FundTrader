"""Deep fund analysis API."""

import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException
from starlette.concurrency import run_in_threadpool

from ..config import CACHE_TTL_INFO
from ..data.cache_manager import cache
from ..services.analysis_service import analyze_fund, normalize_nav_data
from ..services.llm_service import (
    analyze_fund_comprehensive,
    analyze_manager_style,
)

router = APIRouter(prefix="/analysis", tags=["deep-analysis"])

FUND_CODE_PATTERN = re.compile(r"^\d{6}$")


def _validate_fund_code(code: str) -> None:
    if not FUND_CODE_PATTERN.match(code):
        raise HTTPException(status_code=400, detail="Invalid fund code, expected 6 digits")


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
                if isinstance(item, dict)
                else item
                for item in holdings
            ]
    except Exception:
        pass
    return data


def _to_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(str(value).replace("%", ""))
        return number if math.isfinite(number) else None
    except Exception:
        return None


def _calc_nav_risk_metrics(nav_data: List[Dict[str, Any]]) -> Dict[str, float | None]:
    points: List[float] = []
    for item in normalize_nav_data(nav_data):
        nav = _to_float(item.get("accum_nav") if item.get("accum_nav") not in (None, "", 0) else item.get("nav"))
        if nav is not None and nav > 0:
            points.append(nav)
    if len(points) < 2:
        return {"sharpeRatio": None, "maxDrawdown": None}

    daily_returns: List[float] = []
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

    return {"sharpeRatio": sharpe_ratio, "maxDrawdown": round(max_drawdown, 2)}


def _fill_missing_nav_metrics(data: Dict[str, Any]) -> Dict[str, Any]:
    if not data or not isinstance(data, dict):
        return data
    normalized_nav_data = normalize_nav_data(data.get("nav_data") or [])
    if normalized_nav_data != (data.get("nav_data") or []):
        data = dict(data)
        data["nav_data"] = normalized_nav_data
    metrics = _calc_nav_risk_metrics(normalized_nav_data)
    if metrics.get("sharpeRatio") is None and metrics.get("maxDrawdown") is None:
        return data
    enriched = dict(data)
    if metrics.get("sharpeRatio") is not None:
        enriched["sharpe_ratio"] = metrics.get("sharpeRatio")
    if metrics.get("maxDrawdown") is not None:
        enriched["max_drawdown"] = metrics.get("maxDrawdown")
    return enriched


def cached_analyze_fund(code: str) -> Dict[str, Any]:
    cache_key = f"analysis_full_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO)
    if cached:
        enriched = _fill_missing_nav_metrics(cached)
        enriched = _fill_missing_fees(code, enriched)
        enriched = _fill_missing_holding_changes(enriched)
        if enriched != cached:
            cache.set(cache_key, enriched)
        return enriched

    result = analyze_fund(code)
    if result and not result.get("error"):
        result = _fill_missing_nav_metrics(result)
        result = _fill_missing_fees(code, result)
        result = _fill_missing_holding_changes(result)
        cache.set(cache_key, result)
    return result


def _run_analysis_batch(codes: List[str]) -> Dict[str, Any]:
    results: Dict[str, Any] = {}
    with ThreadPoolExecutor(max_workers=8) as executor:
        future_to_code = {executor.submit(cached_analyze_fund, code): code for code in set(codes)}
        for future in as_completed(future_to_code):
            code = future_to_code[future]
            try:
                results[code] = future.result()
            except Exception as e:
                results[code] = {"code": code, "error": str(e)}
    return {"results": results}


@router.get("/{code}")
async def fund_analysis(code: str):
    _validate_fund_code(code)
    return await run_in_threadpool(cached_analyze_fund, code)


@router.post("/batch")
async def fund_analysis_batch(codes: List[str]) -> Dict[str, Any]:
    for code in codes:
        _validate_fund_code(code)
    return await run_in_threadpool(_run_analysis_batch, codes)


@router.get("/{code}/style")
async def manager_style_analysis(code: str):
    _validate_fund_code(code)
    fund_data = await run_in_threadpool(cached_analyze_fund, code)
    manager = fund_data.get("manager")
    if not manager:
        return {"error": "manager info not found"}

    style = await run_in_threadpool(
        analyze_manager_style,
        manager.get("name", "unknown"),
        code,
        fund_data.get("name", code),
        str(fund_data.get("nav_data", [])[-20:]),
        str(fund_data.get("holdings", [])[:5]),
    )
    return {"code": code, "style_analysis": style}


@router.get("/{code}/llm_review")
async def fund_llm_review(code: str):
    cache_key = f"llm_review_v3_{code}"
    cached = cache.get(cache_key, CACHE_TTL_INFO * 6)
    if cached:
        return cached

    # 短缓存：LLM 失败后避免反复重试
    fail_cache_key = f"llm_review_fail_{code}"
    fail_cached = cache.get(fail_cache_key, CACHE_TTL_INFO)
    if fail_cached:
        return fail_cached

    fund_data = await run_in_threadpool(cached_analyze_fund, code)
    if fund_data.get("error"):
        payload = {"code": code, "review": {"raw": f"基金数据获取失败: {fund_data.get('error')}"}}
        cache.set(fail_cache_key, payload)
        return payload
    nav_metrics = _calc_nav_risk_metrics(fund_data.get("nav_data") or [])
    perf = {
        "return1y": fund_data.get("return1y"),
        "return3y": fund_data.get("return3y"),
        "return5y": fund_data.get("return5y"),
        "annualizedReturn": fund_data.get("annualized_return"),
        "sharpeRatio": nav_metrics.get("sharpeRatio"),
        "maxDrawdown": nav_metrics.get("maxDrawdown"),
    }
    try:
        review = await run_in_threadpool(
            analyze_fund_comprehensive,
            code,
            fund_data.get("name", code),
            perf,
            fund_data.get("manager") or {},
            fund_data.get("holdings") or [],
        )
    except Exception as e:
        payload = {"code": code, "review": {"raw": f"LLM 分析调用异常: {e}"}}
        cache.set(fail_cache_key, payload)
        return payload
    if review:
        payload = {"code": code, "review": review}
        cache.set(cache_key, payload)
        return payload
    payload = {"code": code, "review": {"raw": "LLM 分析返回为空，可能是 API 密钥未配置或调用超时"}}
    cache.set(fail_cache_key, payload)
    return payload
