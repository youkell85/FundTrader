"""基金排名筛选API"""
from fastapi import APIRouter, Query, File, UploadFile, Body
from typing import Optional
import base64
from ..services.fund_service import get_fund_list, get_fund_list_from_watchlist
from ..services.image_search_service import recognize_funds_from_image, match_funds_with_list

router = APIRouter(prefix="/fund", tags=["基金排名筛选"])


@router.get("/list")
async def fund_list(
    category: str = Query("全部", description="基金类型"),
    tag: Optional[str] = Query(None, description="标签筛选"),
    keyword: Optional[str] = Query(None, description="关键词搜索"),
    sort_by: str = Query("今年来", description="排序字段"),
    sort_order: str = Query("desc", description="排序方向"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    guoyuan_only: bool = Query(True, description="仅国元名单"),
    use_watchlist: bool = Query(False, description="使用自选基金列表"),
):
    if use_watchlist:
        return get_fund_list_from_watchlist(category, tag, keyword, sort_by, sort_order, page, page_size)
    return get_fund_list(category, tag, keyword, sort_by, sort_order, page, page_size, guoyuan_only)


@router.get("/categories")
async def fund_categories():
    from ..constants.guoyuan_funds import FUND_CATEGORIES, FUND_TYPES
    return {"categories": FUND_CATEGORIES, "types": FUND_TYPES}


@router.post("/image-search")
async def image_search(
    file: UploadFile = File(None, description="上传的基金截图"),
    image_base64: Optional[str] = Query(None, description="Base64编码的图片数据（与file二选一）"),
    body: Optional[dict] = Body(None),
):
    """上传图片识别基金产品。支持 multipart 文件上传、query base64 或 JSON body。"""
    base64_image = ""
    mime_type = "image/jpeg"

    if file:
        content = await file.read()
        base64_image = base64.b64encode(content).decode("utf-8")
        mime_type = file.content_type or "image/jpeg"
    elif image_base64:
        base64_image = image_base64
        if base64_image.startswith("data:"):
            parts = base64_image.split(";")
            if len(parts) >= 2 and parts[0].startswith("data:"):
                mime_type = parts[0][5:] or "image/jpeg"
            base64_image = base64_image.split(",")[-1]
    elif body and body.get("image_base64"):
        base64_image = body["image_base64"]
        if base64_image.startswith("data:"):
            parts = base64_image.split(";")
            if len(parts) >= 2 and parts[0].startswith("data:"):
                mime_type = parts[0][5:] or "image/jpeg"
            base64_image = base64_image.split(",")[-1]
    else:
        return {"success": False, "summary": "", "funds": [], "error": "请上传图片或提供base64数据"}

    # 调用多模态LLM识别图片中的基金
    recognition = recognize_funds_from_image(base64_image, mime_type)

    if recognition.get("error"):
        return {
            "success": False,
            "summary": recognition.get("summary", ""),
            "funds": [],
            "error": recognition.get("error"),
        }

    # 获取基金列表进行匹配
    fund_list_result = get_fund_list(guoyuan_only=True, page_size=10000)
    all_funds = fund_list_result.get("funds", [])

    recognized_funds = recognition.get("funds", [])
    matched = match_funds_with_list(recognized_funds, all_funds)

    return {
        "success": True,
        "summary": recognition.get("summary", ""),
        "recognized_count": len(recognized_funds),
        "matched_count": len(matched),
        "funds": matched,
    }
