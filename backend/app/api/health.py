"""Provider and data-source health endpoints.

Exposes:
  GET /health                     → liveness check
  GET /data-sources/status        → merged provider health from fusion + gateway
"""

from fastapi import APIRouter

router = APIRouter(tags=["health"])


@router.get("/health")
async def health():
    """Liveness check — used by load balancers and monitoring."""
    return {"status": "ok", "service": "FundTrader"}


@router.get("/data-sources/status")
async def data_sources_status():
    """Unified provider health endpoint.

    Merges fusion-layer providers (Tushare, iFinD, TickFlow, Tencent) with
    gateway-tracked providers (AkShare, efinance, Eastmoney).
    """
    from ..data.providers.fusion import get_fusion
    from ..data.data_gateway import data_gateway

    fusion_snapshot = get_fusion().get_provider_health_snapshot()
    gateway_snapshot = data_gateway.get_health_snapshot()

    fusion_providers = fusion_snapshot.get("providers", [])
    gateway_providers = gateway_snapshot.get("providers", [])

    # deduplicate: fusion providers take precedence; gateway fills gaps
    fusion_names = {p.get("name") for p in fusion_providers}
    merged = list(fusion_providers)
    for gp in gateway_providers:
        if gp.get("name") not in fusion_names:
            merged.append(gp)

    available_count = sum(1 for p in merged if p.get("available"))
    return {
        "status": "available" if available_count > 0 else "missing",
        "updatedAt": fusion_snapshot.get("updated_at") or gateway_snapshot.get("updatedAt"),
        "providers": merged,
        "availableCount": available_count,
        "totalCount": len(merged),
    }
