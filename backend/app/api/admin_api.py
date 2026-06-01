"""Admin API — user management, system stats, audit."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .auth_middleware import get_current_user
from ..storage.database import get_db

router = APIRouter(prefix="/admin", tags=["管理"])


def _require_admin(user: dict = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(403, "需要管理员权限")
    return user


# ─── Dashboard Stats ──────────────────────────────────────────────────────────

@router.get("/stats")
async def admin_stats(admin: dict = Depends(_require_admin)):
    """Get admin dashboard statistics."""
    with get_db() as conn:
        total_users = conn.execute("SELECT COUNT(*) as c FROM users").fetchone()["c"]
        active_sessions = conn.execute(
            "SELECT COUNT(*) as c FROM sessions WHERE expires_at > datetime('now')"
        ).fetchone()["c"]
        fund_count = conn.execute("SELECT COUNT(*) as c FROM fund_pool WHERE is_active = 1").fetchone()["c"]
        plan_count = conn.execute("SELECT COUNT(*) as c FROM allocation_plans").fetchone()["c"]
        recent_logins = conn.execute(
            "SELECT u.username, s.created_at FROM sessions s JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC LIMIT 5"
        ).fetchall()

    return {
        "total_users": total_users,
        "active_sessions": active_sessions,
        "fund_count": fund_count,
        "plan_count": plan_count,
        "recent_logins": [{"username": r["username"], "time": r["created_at"]} for r in recent_logins],
    }


@router.get("/data-health")
async def data_health(admin: dict = Depends(_require_admin)):
    """Data-center health, external call volume and failure risk."""
    from ..storage.database import FundDataStore

    return FundDataStore.data_status()


# ─── User Management ──────────────────────────────────────────────────────────

class UserUpdateBody(BaseModel):
    role: str | None = None
    disabled: bool | None = None


@router.get("/users")
async def list_users(admin: dict = Depends(_require_admin)):
    """List all users with their details."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT id, username, display_name, email, email_verified, avatar_url, role, created_at, updated_at
               FROM users ORDER BY created_at DESC"""
        ).fetchall()
        users = []
        for r in rows:
            sessions = conn.execute(
                "SELECT COUNT(*) as c FROM sessions WHERE user_id = ? AND expires_at > datetime('now')", (r["id"],)
            ).fetchone()
            users.append({
                "id": r["id"], "username": r["username"], "displayName": r["display_name"],
                "email": r["email"] or "", "emailVerified": bool(r["email_verified"]),
                "avatarUrl": r["avatar_url"] or "", "role": r["role"],
                "createdAt": r["created_at"], "activeSessions": sessions["c"],
            })
        return {"users": users}


@router.get("/users/{user_id}")
async def get_user(user_id: str, admin: dict = Depends(_require_admin)):
    """Get detailed info for a single user."""
    with get_db() as conn:
        r = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not r:
            raise HTTPException(404, "用户不存在")
        sessions = conn.execute(
            "SELECT created_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
            (user_id,)
        ).fetchall()
        return {
            "id": r["id"], "username": r["username"], "displayName": r["display_name"],
            "email": r["email"] or "", "emailVerified": bool(r["email_verified"]),
            "avatarUrl": r["avatar_url"] or "", "role": r["role"],
            "createdAt": r["created_at"], "updatedAt": r["updated_at"],
            "sessions": [{"loginAt": s["created_at"], "expiresAt": s["expires_at"]} for s in sessions],
        }


@router.post("/users/{user_id}")
async def update_user(user_id: str, body: UserUpdateBody, admin: dict = Depends(_require_admin)):
    """Update user role or disable/enable."""
    updates = []
    params = []
    if body.role is not None:
        updates.append("role = ?")
        params.append(body.role)
    if body.disabled is not None:
        updates.append("is_active = ?")
        params.append(0 if body.disabled else 1)
    if not updates:
        raise HTTPException(400, "无更新内容")
    from datetime import datetime
    updates.append("updated_at = ?")
    params.append(datetime.now().isoformat())
    params.append(user_id)
    with get_db() as conn:
        conn.execute(f"UPDATE users SET {', '.join(updates)} WHERE id = ?", params)
    return {"ok": True}
