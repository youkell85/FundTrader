"""LLM调用服务 - 分析基金经理投资风格"""
import json
import urllib.request
from typing import Optional
from ..utils import console_error
from ..config import LLM_API_URL, LLM_API_KEY, LLM_MODEL


def analyze_manager_style(
    manager_name: str,
    fund_code: str,
    fund_name: str,
    performance_data: str = "",
    holdings_data: str = "",
) -> Optional[str]:
    """调用LLM分析基金经理投资风格"""
    if not LLM_API_KEY:
        return "AI分析服务未配置（缺少LLM_API_KEY），请联系管理员配置SiliconFlow API密钥"

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
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 500,
            "temperature": 0.7,
        }).encode("utf-8")

        req = urllib.request.Request(
            LLM_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")

    except Exception as e:
        console_error(f"LLM analysis error: {e}")
        return f"LLM分析暂不可用（{str(e)[:50]}），请稍后重试"


def analyze_fund_comprehensive(
    fund_code: str,
    fund_name: str,
    perf_data: dict,
    manager_data: dict,
    holdings_data: list = None,
) -> Optional[str]:
    """调用 LLM 对基金业绩与基金经理进行全面分析。返回json格式的多维度点评。"""
    if not LLM_API_KEY:
        return None

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

    prompt = f"""你是资深公募基金分析师，请对以下基金进行专业分析，仅输出JSON（不要markdown不要多余文本）：

基金：{fund_name}({fund_code})
业绩：{', '.join(perf_summary)}
基金经理：{mgr_name}，任职{tenure_years}年
重仓股：{holdings_str or '暂无数据'}

JSON格式：
{{"performance_review":"业绩点评150字以内","manager_review":"经理点评150字以内","holdings_review":"持仓点评100字以内","investment_advice":"投资建议100字以内","risk_warnings":["风险点1","风险点2"],"strengths":["优势1","优势2","优势3"]}}"""

    try:
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 1200,
            "temperature": 0.3,
        }).encode("utf-8")
        req = urllib.request.Request(LLM_API_URL, data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        })
        with urllib.request.urlopen(req, timeout=45) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            content = content.strip().lstrip("`").rstrip("`")
            if content.startswith("json"):
                content = content[4:].strip()
            try:
                return json.loads(content)
            except Exception:
                return {"raw": content}
    except Exception as e:
        console_error(f"LLM comprehensive analysis error: {e}")
        return None


def analyze_dca_strategy(
    fund_code: str,
    fund_name: str,
    dca_metrics: dict,
    benchmark_metrics: dict,
) -> Optional[str]:
    """为定投回测生成专业评价，对比买入持有策略。"""
    if not LLM_API_KEY:
        return None
    prompt = f"""你是资深基金定投策略顾问。请对以下回测结果进行专业评价：

基金：{fund_name}({fund_code})
【定投策略】
  - 总投入：{dca_metrics.get('total_invested')}元
  - 最终市值：{dca_metrics.get('final_value')}元
  - 总收益率：{dca_metrics.get('total_return')}%
  - 年化：{dca_metrics.get('annualized_return')}%
  - 最大回撤：{dca_metrics.get('max_drawdown')}%
【买入持有基准】
  - 一次性投入：{benchmark_metrics.get('total_invested')}元
  - 最终市值：{benchmark_metrics.get('final_value')}元
  - 总收益率：{benchmark_metrics.get('profit_rate')}%

请仅输出JSON（不要markdown）：
{{"verdict":"定投还是一次性买入更优，30字内","analysis":"策略对比点评200字以内，包含夏普、回撤、心理负担三个角度","suggestions":["建葮1","建葮2","建葮3"]}}"""
    try:
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 800,
            "temperature": 0.3,
        }).encode("utf-8")
        req = urllib.request.Request(LLM_API_URL, data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {LLM_API_KEY}",
        })
        with urllib.request.urlopen(req, timeout=45) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            content = content.strip().lstrip("`").rstrip("`")
            if content.startswith("json"):
                content = content[4:].strip()
            try:
                return json.loads(content)
            except Exception:
                return {"raw": content}
    except Exception as e:
        console_error(f"LLM dca analysis error: {e}")
        return None


def generate_recommendation_analysis(
    risk_level: str,
    funds: list,
    market_summary: str = "",
) -> Optional[str]:
    """调用LLM生成推荐分析"""
    if not LLM_API_KEY:
        return None

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
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 400,
            "temperature": 0.7,
        }).encode("utf-8")

        req = urllib.request.Request(
            LLM_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
        )

        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            return result.get("choices", [{}])[0].get("message", {}).get("content", "")

    except Exception as e:
        console_error(f"LLM recommendation error: {e}")
        return None
