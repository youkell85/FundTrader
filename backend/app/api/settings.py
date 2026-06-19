"""设置与自选基金管理API"""
from fastapi import APIRouter, UploadFile, File, Query
from typing import Optional, List
from pydantic import BaseModel
from ..services.watchlist_service import (
    get_watchlist, add_fund, add_funds_batch, remove_fund, clear_watchlist
)
from ..services.file_parser_service import parse_file
from ..storage.database import FundDataStore

router = APIRouter(prefix="/settings", tags=["设置与自选管理"])

SNAPSHOT_POOL_SOURCE = "fund_snapshot"


class AddFundRequest(BaseModel):
    code: str
    name: str = ""
    type: str = ""
    tags: List[str] = []


class BatchAddRequest(BaseModel):
    funds: List[AddFundRequest]


def _snapshot_pool(limit: int = 5000) -> dict:
    result = FundDataStore.list_snapshots(
        xinjihui_only=True,
        limit=limit,
        offset=0,
        sort_field="near_1y",
        sort_order="desc",
    )
    raw_funds = result.get("funds") or []
    funds = []
    as_of_values = []
    for fund in raw_funds:
        if not isinstance(fund, dict) or not fund.get("code"):
            continue
        as_of = fund.get("nav_date") or fund.get("updated_at") or fund.get("metrics_updated_at")
        if as_of:
            as_of_values.append(str(as_of))
        funds.append({
            "code": str(fund.get("code")),
            "name": fund.get("name") or str(fund.get("code")),
            "type": fund.get("type") or "",
            "tags": fund.get("tags") or [],
            "source": SNAPSHOT_POOL_SOURCE,
            "as_of": as_of,
        })
    data_status = "real" if funds else "missing"
    missing_reason = None if funds else "基金快照为空；未返回静态基金池，请先刷新 fund_quote_snapshot。"
    return {
        "funds": funds,
        "total": len(funds),
        "source": SNAPSHOT_POOL_SOURCE,
        "data_status": data_status,
        "missing_reason": missing_reason,
        "as_of": max(as_of_values) if as_of_values else None,
    }


def _watchlist_import_payload(pool: dict) -> List[dict]:
    return [
        {
            "code": fund["code"],
            "name": fund.get("name", ""),
            "type": fund.get("type", ""),
            "tags": fund.get("tags", []),
        }
        for fund in pool.get("funds", [])
    ]


@router.get("/watchlist")
async def list_watchlist():
    """获取自选基金列表"""
    return {"funds": get_watchlist()}


@router.post("/watchlist/add")
async def add_to_watchlist(req: AddFundRequest):
    """添加单只自选基金"""
    return add_fund(req.code, req.name, req.type, req.tags)


@router.post("/watchlist/add-batch")
async def batch_add_to_watchlist(req: BatchAddRequest):
    """批量添加自选基金"""
    funds = [f.dict() for f in req.funds]
    return add_funds_batch(funds)


@router.delete("/watchlist/{code}")
async def remove_from_watchlist(code: str):
    """移除自选基金"""
    return remove_fund(code)


@router.delete("/watchlist")
async def clear_all_watchlist():
    """清空自选基金"""
    return clear_watchlist()


@router.post("/upload")
async def upload_fund_file(file: UploadFile = File(...)):
    """上传文件识别基金代码

    支持 Excel(.xlsx/.xls)、CSV、TXT、图片、JSON 格式
    """
    if not file.filename:
        return {"funds": [], "errors": ["未提供文件名"]}

    # 校验文件扩展名白名单
    allowed_extensions = {".xlsx", ".xls", ".csv", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".json"}
    ext = file.filename.lower()
    ext = ext[ext.rfind("."):] if "." in ext else ""
    if ext not in allowed_extensions:
        return {"funds": [], "errors": [f"不支持的文件类型: {ext}"]}

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB限制
        return {"funds": [], "errors": ["文件大小超过10MB限制"]}

    result = parse_file(file.filename, content)
    return result


@router.get("/guoyuan-funds")
async def get_guoyuan_funds():
    """获取鑫基荟默认基金名单（保留旧路由兼容）"""
    return _snapshot_pool()


@router.post("/import-guoyuan")
async def import_guoyuan_funds():
    """将鑫基荟默认名单导入自选（保留旧路由兼容）"""
    pool = _snapshot_pool()
    if pool["data_status"] == "missing":
        return {
            "added": [],
            "skipped": [],
            "invalid": [],
            "total": len(get_watchlist()),
            "source": pool["source"],
            "data_status": "missing",
            "missing_reason": pool["missing_reason"],
        }
    result = add_funds_batch(_watchlist_import_payload(pool))
    return {**result, "source": pool["source"], "data_status": pool["data_status"], "as_of": pool["as_of"]}


@router.get("/xinjihui-pool")
async def get_xinjihui_pool():
    """获取鑫基荟优选池产品名单"""
    return _snapshot_pool()


@router.post("/import-xinjihui")
async def import_xinjihui_pool():
    """将鑫基荟优选池名单导入自选"""
    pool = _snapshot_pool()
    if pool["data_status"] == "missing":
        return {
            "added": [],
            "skipped": [],
            "invalid": [],
            "total": len(get_watchlist()),
            "source": pool["source"],
            "data_status": "missing",
            "missing_reason": pool["missing_reason"],
        }
    result = add_funds_batch(_watchlist_import_payload(pool))
    return {**result, "source": pool["source"], "data_status": pool["data_status"], "as_of": pool["as_of"]}
