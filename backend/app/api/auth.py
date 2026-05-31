"""Auth API — register, login, logout, session validation.
Stores users in SQLite via UserStore class.
"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..storage.database import UserStore, init_db as _init_db

router = APIRouter(prefix="/auth", tags=["认证"])

# Seed admin on module load
_init_db()
UserStore.seed_admin()


class RegisterBody(BaseModel):
    username: str
    password: str
    displayName: str = ""


class LoginBody(BaseModel):
    username: str
    password: str


@router.post("/register")
async def register(body: RegisterBody, request: Request):
    """Register a new user."""
    if len(body.username) < 2 or len(body.password) < 3:
        raise HTTPException(400, "用户名至少2字符，密码至少3字符")
    user = UserStore.register(body.username.strip().lower(), body.password, body.displayName)
    if not user:
        raise HTTPException(409, "用户名已存在")
    token = UserStore.create_session(user["id"])
    return {"user": user, "token": token}


@router.post("/login")
async def login(body: LoginBody, request: Request):
    """Login with username + password."""
    user = UserStore.login(body.username.strip().lower(), body.password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    token = UserStore.create_session(user["id"])
    return {"user": user, "token": token}


@router.post("/logout")
async def logout(request: Request):
    """Logout by clearing session."""
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        UserStore.delete_session(token)
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    """Get current user from session token."""
    token = request.cookies.get("kimi_sid") or request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        raise HTTPException(401, "未登录")
    user = UserStore.get_user_by_session(token)
    if not user:
        raise HTTPException(401, "会话已过期")
    return {"user": user}
