"""Auth API — register, login, logout, email verify, password reset, profile."""
import re
import secrets

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from ..storage.database import UserStore, init_db as _init_db

router = APIRouter(prefix="/auth", tags=["认证"])

_init_db()
UserStore.seed_admin()

EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$")


class RegisterBody(BaseModel):
    username: str
    password: str
    email: str
    displayName: str = ""


class LoginBody(BaseModel):
    username: str
    password: str


class ForgotBody(BaseModel):
    username: str
    email: str


class ResetBody(BaseModel):
    token: str


class UpdateProfileBody(BaseModel):
    displayName: str = ""
    email: str = ""
    avatarUrl: str = ""


# ─── Register ─────────────────────────────────────────────────────────────────

@router.post("/register")
async def register(body: RegisterBody, request: Request):
    """Register with email verification."""
    if len(body.username) < 2 or len(body.password) < 8:
        raise HTTPException(400, "用户名至少2字符，密码至少8字符")
    if not EMAIL_RE.match(body.email):
        raise HTTPException(400, "请输入有效的邮箱地址")
    user = UserStore.register(body.username.strip().lower(), body.password, body.displayName,
                               body.email.strip().lower())
    if not user:
        raise HTTPException(409, "用户名已存在")
    # Send verification email
    UserStore.create_email_token(user["id"], body.email, "verify")
    token = UserStore.create_session(user["id"])
    return {"user": user, "token": token, "message": "注册成功，请检查邮箱完成验证"}


# ─── Login / Logout / Me ──────────────────────────────────────────────────────

@router.post("/login")
async def login(body: LoginBody, request: Request):
    user = UserStore.login(body.username.strip().lower(), body.password)
    if not user:
        raise HTTPException(401, "用户名或密码错误")
    token = UserStore.create_session(user["id"])
    return {"user": user, "token": token}


@router.post("/logout")
async def logout(request: Request):
    token = request.headers.get("Authorization", "").replace("Bearer ", "")
    if token:
        UserStore.delete_session(token)
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    token = request.cookies.get("kimi_sid") or request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        raise HTTPException(401, "未登录")
    user = UserStore.get_user_by_session(token)
    if not user:
        raise HTTPException(401, "会话已过期")
    return {"user": user}


# ─── Email Verification ──────────────────────────────────────────────────────

@router.post("/verify-email")
async def verify_email(body: ResetBody):
    """Verify email with token from email link."""
    u = UserStore.verify_email_token(body.token)
    if not u:
        raise HTTPException(400, "验证链接无效或已过期")
    return {"ok": True, "message": "邮箱验证成功"}


# ─── Forgot / Reset Password ─────────────────────────────────────────────────

@router.post("/forgot-password")
async def forgot_password(body: ForgotBody):
    """Send password reset email with new random password."""
    ok = UserStore.reset_password_send(body.username.strip().lower(), body.email.strip().lower())
    if not ok:
        raise HTTPException(400, "用户名或邮箱不匹配")
    return {"message": "新密码已发送到你的邮箱，请查收"}


# ─── Profile ─────────────────────────────────────────────────────────────────

@router.post("/update-profile")
async def update_profile(body: UpdateProfileBody, request: Request):
    """Update display name, email, avatar."""
    token = request.cookies.get("kimi_sid") or request.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        raise HTTPException(401, "未登录")
    user = UserStore.get_user_by_session(token)
    if not user:
        raise HTTPException(401, "会话已过期")
    UserStore.update_profile(user["id"], body.displayName, body.email, body.avatarUrl)
    return {"ok": True}

