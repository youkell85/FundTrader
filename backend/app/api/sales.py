from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter, Depends
from starlette.concurrency import run_in_threadpool

from .auth_middleware import get_optional_user
from ..allocation.models import ComplianceResultModel, SalesNarrativeRequest, SalesNarrativeResponse
from ..services.audit_service import write_audit_event
from ..services.compliance_check import check_compliance
from ..services.talk_generator import generate_sales_narrative


router = APIRouter(prefix="/sales", tags=["sales"])


class ComplianceCheckRequest(BaseModel):
    text: str


class ComplianceCheckResponse(BaseModel):
    compliance: ComplianceResultModel
    audit_id: str


@router.post("/narrative", response_model=SalesNarrativeResponse)
async def sales_narrative(request: SalesNarrativeRequest, user: dict | None = Depends(get_optional_user)):
    if user and not request.owner_user_id:
        request.owner_user_id = str(user.get("id") or "")
    return await run_in_threadpool(generate_sales_narrative, request)


@router.post("/compliance-check", response_model=ComplianceCheckResponse)
async def compliance_check_endpoint(request: ComplianceCheckRequest, user: dict | None = Depends(get_optional_user)):
    result = check_compliance(request.text)
    audit_id = await run_in_threadpool(
        write_audit_event,
        "sales_compliance_check",
        {"text": request.text[:500], "compliance": result.model_dump()},
        str(user.get("id")) if user else None,
        None,
        str(user.get("id")) if user else None,
        None,
        result.level if result.level != "block" else "rejected",
    )
    return ComplianceCheckResponse(compliance=result, audit_id=audit_id)
