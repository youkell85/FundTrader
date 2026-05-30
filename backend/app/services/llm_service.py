"""LLM调用服务 - 分析基金经理投资风格

v2.0: 异步 httpx + 指数退避重试 + 熔断器
"""
import json
import re
import time
import asyncio
from typing import Optional

import httpx

from ..utils import console_error
from ..config import LLM_API_URL, LLM_API_KEY, LLM_MODEL


# ======================== 熔断器 ========================
class CircuitBreaker:
    """连续失败 N 次后进入冷却期，拒绝新请求，避免雪崩"""

    def __init__(self, failure_threshold: int = 5, cooldown_sec: float = 30.0):
        self.failure_threshold = failure_threshold
        self.cooldown_sec = cooldown_sec
        self._failures = 0
        self._last_failure_time: float = 0.0
        self._open_until: float = 0.0

    @property
    def is_open(self) -> bool:
        return time.monotonic() < self._open_until

    def success(self) -> None:
        self._failures = 0
        self._open_until = 0.0

    def failure(self) -> None:
        self._failures += 1
        self._last_failure_time = time.monotonic()
        if self._failures >= self.failure_threshold:
            self._open_until = time.monotonic() + self.cooldown_sec
            console_error(
                f"[CircuitBreaker] OPEN — {self._failures} consecutive failures, "
                f"cooldown until +{self.cooldown_sec:.0f}s"
            )


# 全局熔断器实例
_cb = CircuitBreaker(failure_threshold=5, cooldown_sec=30.0)


# ======================== HTTP 客户端 ========================
_client: Optional[httpx.AsyncClient] = None


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=15.0),
            limits=httpx.Limits(max_keepalive_connections=5, max_connections=10),
        )
    return _client


# ======================== 工具函数 ========================
def _is_minimax() -> bool:
    return "api.minimaxi.com" in LLM_API_URL.lower() or LLM_MODEL.lower().startswith("minimax")


def _build_payload(messages: list, max_tokens: int, temperature: float) -> dict:
    payload = {
        "model": LLM_MODEL,
        "messages": messages,
        "temperature": temperature,
    }
    if _is_minimax():
        payload["max_completion_tokens"] = 2048
        payload["reasoning_split"] = True
    else:
        payload["max_tokens"] = max_tokens
    return payload


def _strip_reasoning(content: str) -> str:
    if not content:
        return ""
    return re.sub(r"^\s*<think>[\s\S]*?</think>\s*", "", content).strip()


def _choice_content(result: dict) -> str:
    content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
    return _strip_reasoning(content)


def _parse_json_lenient(content: str) -> Optional[dict]:
    """宽容解析 LLM 返回的 JSON：去除 markdown、提取首个 JSON 对象。"""
    if not content:
        return None
    s = content.strip()
    fence = re.match(r"^```(?:json)?\s*([\s\S]*?)```\s*$", s)
    if fence:
        s = fence.group(1).strip()
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        s = m.group(0)
    try:
        return json.loads(s)
    except Exception:
        return None


# ======================== 核心调用（指数退避重试） ========================
async def _call_llm_with_retry(
    messages: list,
    max_tokens: int = 500,
    temperature: float = 0.7,
    llm_timeout: float = 45.0,
    max_retries: int = 3,
) -> dict:
    """带指数退避重试的 LLM HTTP 调用。

    Retry 策略: 1s → 2s → 4s 退避
    熔断器: 连续 5 次失败后拒绝 30s
    """
    if _cb.is_open:
        raise Exception("CircuitBreaker open — LLM calls temporarily disabled")

    payload = _build_payload(messages, max_tokens, temperature)
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {LLM_API_KEY}",
    }

    last_error = None
    for attempt in range(max_retries + 1):
        try:
            client = _get_client()
            resp = await client.post(
                LLM_API_URL,
                json=payload,
                headers=headers,
                timeout=httpx.Timeout(llm_timeout, connect=15.0),
            )
            resp.raise_for_status()
            result = resp.json()
            _cb.success()
            return result
        except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.ConnectError) as e:
            last_error = e
            remaining = max_retries - attempt
            if remaining > 0:
                delay = 2 ** attempt  # 1s, 2s, 4s
                console_error(
                    f"[LLM] attempt {attempt+1}/{max_retries+1} failed ({e}), "
                    f"retrying in {delay}s..."
                )
                await asyncio.sleep(delay)
            else:
                console_error(f"[LLM] all {max_retries+1} attempts exhausted: {e}")

    _cb.failure()
    raise last_error


# ======================== 公共 API ========================

async def analyze_manager_style(
    manager_name: str,
    fund_code: str,
    fund_name: str,
    performance_data: str = "",
    holdings_data: str = "",
) -> Optional[str]:
    """调用LLM分析基金经理投资风格"""
    if not LLM_API_KEY:
        return "AI分析服务未配置（缺少LLM_API_KEY），请联系管理员配置 API 密钥"

    if _cb.is_open:
        return "LLM 服务暂时过载，请稍后重试"

    prompt = f"""你是一位专业的公募基金分析师。请基于以下信息，分析基金经理{manager_name}的投资风格：

基金：{fund_name}（{fund_code}）
{f"近期业绩：{performance_data}" if performance_data else ""}
{f"持仓信息：{holdings_data}" if holdings_data else ""}

请从以下维度分析：
1. 投资风格（价值/成长/均衡/GARP）
2. 行业偏好
3. 持仓特征（集中度/换手率倾向）
4. 风险偏好
5. 适合的市场环境
6. 配置建议

请用简洁专业的语言回答，不超过300字。"""

    try:
        result = await _call_llm_with_retry(
            [{"role": "user", "content": prompt}],
            max_tokens=500,
            temperature=0.7,
            llm_timeout=45.0,
        )
        return _choice_content(result)
    except Exception as e:
        console_error(f"LLM manager style analysis error: {e}")
        return "LLM分析暂不可用，请稍后重试"


async def analyze_fund_comprehensive(
    fund_code: str,
    fund_name: str,
    perf_data: dict,
    manager_data: dict,
    holdings_data: list = None,
) -> Optional[dict]:
    """调用 LLM 对基金业绩与基金经理进行全面分析。返回 dict 或 {raw: "..."}。"""
    if not LLM_API_KEY:
        return None

    if _cb.is_open:
        return {"raw": "LLM 服务暂时过载，请稍后重试"}

    perf_summary = []
    for k, label in [("return1y", "近1年"), ("return3y", "近3年"), ("return5y", "近5年"),
                     ("annualizedReturn", "年化收益"), ("sharpeRatio", "夏普"),
                     ("maxDrawdown", "最大回撤")]:
        v = perf_data.get(k)
        if v is not None:
            perf_summary.append(f"{label}={v}")

    holdings_str = "、".join([f"{h.get('name','')}({h.get('ratio','')}%)" for h in (holdings_data or [])[:5]])
    mgr_name = manager_data.get("name", "")
    tenure_years = round((manager_data.get("tenure_days") or 0) / 365, 1)

    prompt = f"""你是资深公募基金分析师，请对以下基金进行专业、具体的多周期风控分析，仅输出JSON（不要markdown不要多余文本）：

基金：{fund_name}({fund_code})
业绩：{', '.join(perf_summary)}
基金经理：{mgr_name}，任职{tenure_years}年
重仓股：{holdings_str or '暂无数据'}

JSON格式：
{{"performance_review":"多周期业绩点评180字以内，必须比较近1年/近3年/今年来表现，指出趋势是否稳定","risk_review":"风控指标点评180字以内，必须覆盖最大回撤、夏普、波动收益匹配、回撤修复难度","manager_review":"经理点评150字以内，结合任职年限、管理规模、风格稳定性","holdings_review":"持仓点评120字以内，说明集中度、行业暴露和潜在相关性风险","investment_advice":"投资建议120字以内，给出适合的持有周期、仓位和观察触发条件","risk_warnings":["具体风险点1","具体风险点2","具体风险点3"],"strengths":["优势1","优势2","优势3"]}}"""

    try:
        result = await _call_llm_with_retry(
            [{"role": "user", "content": prompt}],
            max_tokens=1200,
            temperature=0.3,
            llm_timeout=60.0,
        )
        content = _choice_content(result)
        parsed = _parse_json_lenient(content)
        if parsed is not None:
            return parsed
        return {"raw": content}
    except Exception as e:
        console_error(f"LLM comprehensive analysis error: {e}")
        return None


async def analyze_dca_strategy(
    fund_code: str,
    fund_name: str,
    dca_metrics: dict,
    benchmark_metrics: dict,
) -> Optional[dict]:
    """为定投回测生成专业评价，对比买入持有策略。返回 dict。"""
    if not LLM_API_KEY:
        return None

    if _cb.is_open:
        return {"raw": "LLM 服务暂时过载，请稍后重试"}

    def pick(data: dict, *keys, default="数据缺失"):
        for key in keys:
            value = data.get(key)
            if value not in (None, "", "—"):
                return value
        return default

    dca_total_return = pick(dca_metrics, "total_return", "totalReturn")
    bench_total_return = pick(benchmark_metrics, "total_return", "totalReturn", "profit_rate")
    try:
        excess_return = round(float(dca_total_return) - float(bench_total_return), 2)
    except Exception:
        excess_return = "数据缺失"

    prompt = f"""你是资深基金定投与组合回测复核顾问。请只基于给定回测指标评价，不编造未提供的数据，不给出保证收益表述。输出应适合展示在"智能定投与组合回测"页面，语言专业、克制、有建设性。

基金：{fund_name}({fund_code})
【定投策略】
  - 策略/频率：{pick(dca_metrics, 'strategy')} / {pick(dca_metrics, 'frequency')}
  - 总投入：{pick(dca_metrics, 'total_invested', 'totalInvested')}元
  - 最终市值：{pick(dca_metrics, 'final_value', 'finalValue')}元
  - 总收益率：{dca_total_return}%
  - 现金流年化收益：{pick(dca_metrics, 'annualized_return', 'annualizedReturn')}%
  - 最大回撤：{pick(dca_metrics, 'max_drawdown', 'maxDrawdown')}%
  - 夏普比率：{pick(dca_metrics, 'sharpe_ratio', 'sharpeRatio')}
【买入持有基准】
  - 一次性投入：{pick(benchmark_metrics, 'total_invested', 'totalInvested')}元
  - 最终市值：{pick(benchmark_metrics, 'final_value', 'finalValue')}元
  - 总收益率：{bench_total_return}%
  - 年化收益：{pick(benchmark_metrics, 'annual_return', 'annualReturn')}%
  - 最大回撤：{pick(benchmark_metrics, 'max_drawdown', 'maxDrawdown')}%
  - 夏普比率：{pick(benchmark_metrics, 'sharpe_ratio', 'sharpeRatio')}
【相对表现】
  - 定投相对买入持有超额收益：{excess_return}%

请仅输出JSON（不要markdown）：
{{"verdict":"一句话结论，30字以内，明确可执行/谨慎执行/暂缓执行","analysis":"260字以内，用完整段落复核：收益差、最大回撤、夏普、资金占用效率、心理负担；必须说明定投和一次性买入各自适用条件","suggestions":["可直接执行的调参建议，含频率/金额/止损或复核条件","组合或基金筛选层面的改进建议","后续复盘触发条件"],"risk_notes":["指出回测区间、历史净值和未来不确定性的限制","指出费用、滑点、资金连续性或单一资产暴露风险"]}}"""

    try:
        result = await _call_llm_with_retry(
            [{"role": "user", "content": prompt}],
            max_tokens=800,
            temperature=0.3,
            llm_timeout=60.0,
        )
        content = _choice_content(result)
        parsed = _parse_json_lenient(content)
        if parsed is not None:
            return parsed
        return {"raw": content}
    except Exception as e:
        console_error(f"LLM dca analysis error: {e}")
        return None


async def generate_recommendation_analysis(
    risk_level: str,
    funds: list,
    market_summary: str = "",
) -> Optional[str]:
    """调用LLM生成推荐分析"""
    if not LLM_API_KEY:
        return None

    if _cb.is_open:
        return "LLM 服务暂时过载，请稍后重试"

    fund_names = "、".join([f.get("name", "") for f in funds[:5]])
    prompt = f"""你是一位专业的公募基金理财顾问。请基于以下信息，给出配置建议：

风险偏好：{risk_level}
推荐基金：{fund_names}
{f"市场概况：{market_summary}" if market_summary else ""}

请给出：
1. 配置逻辑说明
2. 风险提示
3. 调仓建议

不超过200字，简洁专业。"""

    try:
        result = await _call_llm_with_retry(
            [{"role": "user", "content": prompt}],
            max_tokens=400,
            temperature=0.7,
            llm_timeout=45.0,
        )
        return _choice_content(result)
    except Exception as e:
        console_error(f"LLM recommendation error: {e}")
        return None


async def close_llm_client():
    """关闭 httpx 客户端连接池（在应用 shutdown 时调用）"""
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None
