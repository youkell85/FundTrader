"""设置与自选基金管理API"""
from fastapi import APIRouter, UploadFile, File, Query
from typing import Optional, List
from pydantic import BaseModel
from ..services.watchlist_service import (
    get_watchlist, add_fund, add_funds_batch, remove_fund, clear_watchlist
)
from ..services.file_parser_service import parse_file

router = APIRouter(prefix="/settings", tags=["设置与自选管理"])


class AddFundRequest(BaseModel):
    code: str
    name: str = ""
    type: str = ""
    tags: List[str] = []


class BatchAddRequest(BaseModel):
    funds: List[AddFundRequest]


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

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10MB限制
        return {"funds": [], "errors": ["文件大小超过10MB限制"]}

    result = parse_file(file.filename, content)
    return result


@router.get("/guoyuan-funds")
async def get_guoyuan_funds():
    """获取国元证券默认基金名单"""
    from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST
    return {"funds": GUOYUAN_FUND_LIST}


@router.post("/import-guoyuan")
async def import_guoyuan_funds():
    """将国元证券默认名单导入自选"""
    from ..constants.guoyuan_funds import GUOYUAN_FUND_LIST
    return add_funds_batch(GUOYUAN_FUND_LIST)
