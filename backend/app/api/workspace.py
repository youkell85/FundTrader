"""Institution workspace APIs."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .auth_middleware import get_optional_user
from ..services.client_360 import build_client_360
from ..services.feature_flags import workspace_feature_snapshot
from ..services.nba_engine import build_task_drafts, generate_nba_suggestions


router = APIRouter(prefix="/workspace", tags=["institution-workspace"])


class Client360Request(BaseModel):
    client: dict[str, Any] = Field(default_factory=dict)
    holdings: list[dict[str, Any]] = Field(default_factory=list)
    recent_events: list[dict[str, Any]] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class NbaRequest(BaseModel):
    client_360: dict[str, Any] | None = None
    client: dict[str, Any] = Field(default_factory=dict)
    holdings: list[dict[str, Any]] = Field(default_factory=list)
    context: dict[str, Any] = Field(default_factory=dict)


class TaskDraftRequest(BaseModel):
    suggestions: list[dict[str, Any]] = Field(default_factory=list)


@router.get("/features")
async def get_workspace_features() -> dict[str, Any]:
    flags = workspace_feature_snapshot()
    return {
        "features": flags,
        "policy": {
            "direct_contact_storage": flags["direct_contact_storage"],
            "auto_outreach": flags["auto_outreach"],
            "org_rbac_import": flags["org_rbac_import"],
        },
    }


@router.post("/client-360")
async def create_client_360(
    request: Client360Request,
    user: dict[str, Any] | None = Depends(get_optional_user),
) -> dict[str, Any]:
    owner_user_id = str(user.get("id")) if isinstance(user, dict) and user.get("id") else None
    payload = request.model_dump()
    profile = build_client_360(payload, owner_user_id=owner_user_id)
    return {"client_360": profile}


@router.post("/nba")
async def create_nba_suggestions(
    request: NbaRequest,
    user: dict[str, Any] | None = Depends(get_optional_user),
) -> dict[str, Any]:
    owner_user_id = str(user.get("id")) if isinstance(user, dict) and user.get("id") else None
    profile = request.client_360 or build_client_360(
        {"client": request.client, "holdings": request.holdings, "context": request.context},
        owner_user_id=owner_user_id,
    )
    return generate_nba_suggestions(profile, context=request.context)


@router.post("/task-drafts")
async def create_task_drafts(request: TaskDraftRequest) -> dict[str, Any]:
    return build_task_drafts(request.suggestions)
