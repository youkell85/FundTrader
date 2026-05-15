"""文件解析服务 - 从上传文件中识别基金代码和名称"""
import re
import csv
import io
import json
from typing import List, Dict, Any
from ..utils import console_error


# 基金代码正则：6位数字（A股公募基金代码格式）
FUND_CODE_PATTERN = re.compile(r'\b(0\d{5}|1\d{5}|2\d{5}|5\d{5}|11\d{4}|15\d{4}|16\d{4}|18\d{4}|50\d{4})\b')


def parse_file(filename: str, content: bytes) -> Dict[str, Any]:
    """解析上传文件，识别基金代码和名称

    Args:
        filename: 文件名（含扩展名）
        content: 文件二进制内容

    Returns:
        {"funds": [{"code": "xxx", "name": "xxx", "type": "xxx"}], "errors": [...]}
    """
    ext = filename.lower().split(".")[-1]
    try:
        if ext in ("xlsx", "xls"):
            return _parse_excel(content)
        elif ext == "csv":
            return _parse_csv(content)
        elif ext == "txt":
            return _parse_txt(content)
        elif ext in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
            return _parse_image(content)
        elif ext == "json":
            return _parse_json(content)
        else:
            return {"funds": [], "errors": [f"不支持的文件格式: {ext}"]}
    except Exception as e:
        console_error(f"File parse error ({filename}): {e}")
        return {"funds": [], "errors": [f"文件解析失败: {str(e)}"]}


def _parse_excel(content: bytes) -> Dict[str, Any]:
    """解析Excel文件"""
    try:
        import openpyxl
    except ImportError:
        try:
            import pandas as pd
            df = pd.read_excel(io.BytesIO(content))
            return _extract_funds_from_dataframe(df)
        except ImportError:
            return {"funds": [], "errors": ["需要安装 openpyxl 或 pandas 来解析Excel文件"]}

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True)
    funds = []
    for sheet in wb.worksheets:
        for row in sheet.iter_rows(values_only=True):
            funds.extend(_extract_funds_from_row(row))
    wb.close()
    return {"funds": _deduplicate(funds), "errors": []}


def _parse_csv(content: bytes) -> Dict[str, Any]:
    """解析CSV文件"""
    # 尝试多种编码
    for encoding in ("utf-8", "gbk", "gb2312", "latin-1"):
        try:
            text = content.decode(encoding)
            reader = csv.reader(io.StringIO(text))
            funds = []
            for row in reader:
                funds.extend(_extract_funds_from_row(row))
            return {"funds": _deduplicate(funds), "errors": []}
        except (UnicodeDecodeError, csv.Error):
            continue
    return {"funds": [], "errors": ["CSV文件编码无法识别"]}


def _parse_txt(content: bytes) -> Dict[str, Any]:
    """解析文本文件"""
    for encoding in ("utf-8", "gbk", "gb2312", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        return {"funds": [], "errors": ["文本文件编码无法识别"]}

    funds = []
    lines = text.strip().split("\n")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 尝试多种分隔格式
        # 格式1: 代码 名称（空格/制表符分隔）
        # 格式2: 代码,名称（逗号分隔）
        # 格式3: 纯代码
        parts = re.split(r'[,\t;|]', line)
        if len(parts) >= 2:
            code_match = FUND_CODE_PATTERN.search(parts[0].strip())
            if code_match:
                funds.append({
                    "code": code_match.group(1),
                    "name": parts[1].strip() if len(parts) > 1 else "",
                    "type": "",
                })
                continue
        # 尝试从整行中提取代码
        code_match = FUND_CODE_PATTERN.search(line)
        if code_match:
            # 提取名称（代码后面的部分）
            rest = line[code_match.end():].strip()
            name = re.sub(r'^[,\t;|\s]+', '', rest).strip() if rest else ""
            funds.append({"code": code_match.group(1), "name": name, "type": ""})

    return {"funds": _deduplicate(funds), "errors": []}


def _parse_json(content: bytes) -> Dict[str, Any]:
    """解析JSON文件"""
    try:
        data = json.loads(content.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"funds": [], "errors": ["JSON文件格式错误"]}

    funds = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                code = str(item.get("code", item.get("基金代码", item.get("fund_code", ""))))
                name = str(item.get("name", item.get("基金简称", item.get("fund_name", ""))))
                type_ = str(item.get("type", item.get("基金类型", item.get("fund_type", ""))))
                if FUND_CODE_PATTERN.match(code):
                    funds.append({"code": code, "name": name, "type": type_})
            elif isinstance(item, str):
                code_match = FUND_CODE_PATTERN.search(item)
                if code_match:
                    funds.append({"code": code_match.group(1), "name": "", "type": ""})
    elif isinstance(data, dict):
        items = data.get("funds", data.get("data", data.get("list", [])))
        if isinstance(items, list):
            for item in items:
                code = str(item.get("code", item.get("基金代码", "")))
                name = str(item.get("name", item.get("基金简称", "")))
                if FUND_CODE_PATTERN.match(code):
                    funds.append({"code": code, "name": name, "type": ""})

    return {"funds": _deduplicate(funds), "errors": []}


def _parse_image(content: bytes) -> Dict[str, Any]:
    """解析图片文件 - OCR识别"""
    try:
        # 尝试使用PaddleOCR
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang="ch", show_log=False)
        result = ocr.ocr(content, cls=True)
        texts = []
        if result and result[0]:
            for line in result[0]:
                texts.append(line[1][0])
        full_text = "\n".join(texts)
        return _extract_funds_from_text(full_text)
    except ImportError:
        pass

    try:
        # 尝试使用easyocr
        import easyocr
        reader = easyocr.Reader(["ch_sim", "en"], gpu=False)
        results = reader.readtext(content)
        texts = [r[1] for r in results]
        full_text = "\n".join(texts)
        return _extract_funds_from_text(full_text)
    except ImportError:
        pass

    # 无OCR库时，提示用户手动输入
    return {
        "funds": [],
        "errors": ["图片OCR识别需要安装 paddleocr 或 easyocr，请手动输入基金代码"],
        "raw_text_hint": "请安装OCR库后重试，或使用手动输入功能",
    }


def _extract_funds_from_text(text: str) -> Dict[str, Any]:
    """从文本中提取基金代码和名称"""
    funds = []
    lines = text.strip().split("\n")
    for line in lines:
        line = line.strip()
        if not line:
            continue
        # 查找所有基金代码
        for match in FUND_CODE_PATTERN.finditer(line):
            code = match.group(1)
            # 尝试提取代码附近的名称
            before = line[:match.start()].strip()
            after = line[match.end():].strip()
            # 名称通常在代码后面
            name = re.sub(r'^[,\t;|\s：:]+', '', after).strip()
            if not name:
                # 名称可能在代码前面
                name = re.sub(r'[,\t;|\s：:]+$', '', before).strip()
            # 清理名称中的非中文字符
            name = re.sub(r'[^\u4e00-\u9fffA-Za-z0-9（）()]+', ' ', name).strip()
            funds.append({"code": code, "name": name, "type": ""})

    return {"funds": _deduplicate(funds), "errors": []}


def _extract_funds_from_row(row) -> List[Dict[str, Any]]:
    """从表格行中提取基金信息"""
    funds = []
    row_strs = [str(c) if c is not None else "" for c in row]
    for cell in row_strs:
        code_match = FUND_CODE_PATTERN.search(cell.strip())
        if code_match:
            code = code_match.group(1)
            # 尝试从同行其他列找名称
            name = ""
            type_ = ""
            for other_cell in row_strs:
                other = other_cell.strip()
                if other and not FUND_CODE_PATTERN.match(other) and len(other) > 2:
                    # 包含中文字符的可能是名称
                    if re.search(r'[\u4e00-\u9fff]', other):
                        if not name:
                            name = other
                        elif not type_ and any(t in other for t in ["混合", "股票", "债券", "指数", "QDII", "货币", "FOF"]):
                            type_ = other
            funds.append({"code": code, "name": name, "type": type_})
    return funds


def _extract_funds_from_dataframe(df) -> Dict[str, Any]:
    """从pandas DataFrame中提取基金信息"""
    funds = []
    # 查找包含基金代码的列
    code_col = None
    name_col = None
    type_col = None

    for col in df.columns:
        col_str = str(col)
        if any(k in col_str for k in ["代码", "code", "Code", "基金代码"]):
            code_col = col
        elif any(k in col_str for k in ["名称", "name", "Name", "简称", "基金名称", "基金简称"]):
            name_col = col
        elif any(k in col_str for k in ["类型", "type", "Type", "基金类型"]):
            type_col = col

    # 如果没找到明确列名，遍历所有列找代码
    if code_col is None:
        for col in df.columns:
            for val in df[col].dropna().astype(str):
                if FUND_CODE_PATTERN.match(str(val).strip()):
                    code_col = col
                    break
            if code_col:
                break

    if code_col is not None:
        for _, row in df.iterrows():
            code = str(row[code_col]).strip()
            if FUND_CODE_PATTERN.match(code):
                name = str(row.get(name_col, "")).strip() if name_col else ""
                type_ = str(row.get(type_col, "")).strip() if type_col else ""
                funds.append({"code": code, "name": name, "type": type_})
    else:
        # 遍历所有单元格找代码
        for _, row in df.iterrows():
            funds.extend(_extract_funds_from_row(row.values))

    return {"funds": _deduplicate(funds), "errors": []}


def _deduplicate(funds: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """去重"""
    seen = set()
    result = []
    for f in funds:
        if f["code"] not in seen:
            seen.add(f["code"])
            result.append(f)
    return result