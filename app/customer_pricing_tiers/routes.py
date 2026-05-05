from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.deps import allow_roles_any, csrf_protect, require_roles
from app.customer_pricing_tiers import service
from app.customer_pricing_tiers.schemas import CustomerPricingTierCreate, CustomerPricingTierDTO, CustomerPricingTierUpdate, dto_from_orm
from app.exceptions import DomainError

public_router = APIRouter(prefix="/api/customer-pricing-tiers", tags=["customer-pricing-tiers"])
admin_router = APIRouter(prefix="/api/admin/customer-pricing-tiers", tags=["admin-customer-pricing-tiers"])


@public_router.get("", response_model=list[CustomerPricingTierDTO], dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_customer_pricing_tiers():
    rows = service.list_tiers_ordered()
    return [dto_from_orm(r) for r in rows]


@admin_router.get("", response_model=list[CustomerPricingTierDTO], dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def admin_list_customer_pricing_tiers():
    rows = service.list_tiers_ordered()
    return [dto_from_orm(r) for r in rows]


@admin_router.post(
    "",
    response_model=CustomerPricingTierDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def admin_create_customer_pricing_tier(payload: CustomerPricingTierCreate):
    return service.create_tier(payload)


@admin_router.put(
    "/{tier_id}",
    response_model=CustomerPricingTierDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def admin_update_customer_pricing_tier(tier_id: str, payload: CustomerPricingTierUpdate):
    try:
        return service.update_tier(tier_id, payload)
    except DomainError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)


@admin_router.delete(
    "/{tier_id}",
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def admin_delete_customer_pricing_tier(tier_id: str):
    try:
        service.delete_tier(tier_id)
        return {"ok": True}
    except DomainError as e:
        if "assigned" in (e.message or "").lower():
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=e.message)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message)
