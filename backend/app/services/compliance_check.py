from __future__ import annotations

import re

from ..allocation.models import ComplianceResultModel


FORBIDDEN_CLAIMS = [
    "保本",
    "保收益",
    "保证收益",
    "稳赚",
    "稳赚不赔",
    "一定能涨",
    "必涨",
    "无风险",
    "零风险",
    "刚性兑付",
]

DISCLOSURE = "市场有风险，投资需谨慎。"


def check_compliance(text: str) -> ComplianceResultModel:
    if not text.strip():
        return ComplianceResultModel(level="review", issues=["文本为空，未进行话术生成。"], forbidden_claims=[])

    hits = [claim for claim in FORBIDDEN_CLAIMS if claim in text]
    issues: list[str] = []
    if hits:
        issues.append(f"触发禁止性表述：{', '.join(hits)}。")
    if re.search(r"\d+(\.\d+)?\s*%", text) and DISCLOSURE not in text:
        issues.append("出现收益或比例数字但缺少风险揭示。")

    if hits:
        return ComplianceResultModel(level="block", issues=issues, forbidden_claims=hits)
    if issues:
        return ComplianceResultModel(level="review", issues=issues, forbidden_claims=[])
    return ComplianceResultModel(level="pass", issues=[], forbidden_claims=[])
