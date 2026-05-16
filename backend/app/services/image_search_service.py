"""图片识别基金服务 - 通过上传图片识别基金产品"""
import json
import re
import urllib.request
from typing import List, Dict, Any, Optional
from ..config import LLM_API_URL, LLM_API_KEY, LLM_MODEL
from ..utils import console_error


SYSTEM_PROMPT = """你是一位基金产品识别专家。请仔细查看用户上传的图片，识别其中包含的所有基金产品信息。

请按以下格式输出识别结果（JSON格式）：
{
  "funds": [
    {"code": "基金代码", "name": "基金名称", "confidence": 0.95},
    ...
  ],
  "summary": "图片中识别出的基金概览描述"
}

规则：
1. 基金代码通常是6位数字（如：000001, 110022, 519697）
2. 如果图片中包含基金名称但没有代码，也请输出名称
3. confidence 表示识别置信度（0-1）
4. 只输出JSON，不要其他说明文字
5. 如果图片中没有基金相关信息，返回 {"funds": [], "summary": "未识别到基金产品"}
"""


def recognize_funds_from_image(base64_image: str, mime_type: str = "image/jpeg") -> Dict[str, Any]:
    """调用多模态LLM识别图片中的基金产品"""
    if not LLM_API_KEY:
        return {"funds": [], "summary": "AI识别服务未配置", "error": "缺少LLM_API_KEY"}

    try:
        # 构建多模态消息（OpenAI兼容格式）
        payload = json.dumps({
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "请识别图片中的基金产品，以JSON格式输出结果。"},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:{mime_type};base64,{base64_image}"
                            }
                        }
                    ]
                }
            ],
            "max_tokens": 1000,
            "temperature": 0.3,
            "response_format": {"type": "json_object"},
        }).encode("utf-8")

        req = urllib.request.Request(
            LLM_API_URL,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
            },
        )

        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            parsed = json.loads(content)
            return {
                "funds": parsed.get("funds", []),
                "summary": parsed.get("summary", ""),
            }

    except json.JSONDecodeError as e:
        console_error(f"Image search JSON parse error: {e}")
        return {"funds": [], "summary": "识别结果解析失败", "error": str(e)}
    except Exception as e:
        console_error(f"Image search error: {e}")
        return {"funds": [], "summary": "识别服务暂不可用", "error": str(e)}


def match_funds_with_list(recognized_funds: List[Dict], all_funds: List[Dict]) -> List[Dict]:
    """将识别出的基金与基金列表进行匹配"""
    matched = []
    for rec in recognized_funds:
        code = rec.get("code", "")
        name = rec.get("name", "")
        confidence = rec.get("confidence", 0.5)

        # 先按代码精确匹配
        match = None
        if code:
            for f in all_funds:
                if f.get("code") == code:
                    match = f
                    break

        # 代码未匹配，按名称模糊匹配
        if not match and name:
            for f in all_funds:
                fund_name = f.get("name", "")
                if name in fund_name or fund_name in name:
                    match = f
                    break

        if match:
            matched.append({
                **match,
                "recognition_confidence": confidence,
                "recognized_name": name,
                "recognized_code": code,
            })

    return matched
