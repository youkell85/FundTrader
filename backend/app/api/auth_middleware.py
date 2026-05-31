"""Auth middleware for FastAPI — validates session tokens via UserStore."""
from fastapi import Request, HTTPException, Depends

from ..storage.database import UserStore


async def get_current_user(request: Request) -> dict:
    """Dependency: extract and validate user from session cookie or Bearer token."""
    token = (
        request.cookies.get("kimi_sid")
        or request.headers.get("Authorization", "").replace("Bearer ", "")
    )
    if not token:
        raise HTTPException(401, "请先登录")
    user = UserStore.get_user_by_session(token)
    if not user:
        raise HTTPException(401, "会话已过期，请重新登录")
    return user


# Optional auth — doesn't fail if not logged in
async def get_optional_user(request: Request) -> dict | None:
    try:
        return await get_current_user(request)
    except HTTPException:
        return None
