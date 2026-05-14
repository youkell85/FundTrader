"""LLM调用服务 - 分析基金经理投资风格"""
import json
import urllib.request
from typing import Optional
from ..config import LLM_API_URL, LLM_API_KEY, LLM_MODEL


def analyze_manager_style(
    manager_name: str,
    fund_code: str,
    fund_name: str,
    performance_data: str = "",
    holdings_data: str = "",
) -> Optional[str]:
    """调用LLM分析基金经理投资风格"""
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


def generate_recommendation_analysis(
    risk_level: str,
    funds: list,
    market_summary: str = "",
) -> Optional[str]:
    """调用LLM生成推荐分析"""
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
