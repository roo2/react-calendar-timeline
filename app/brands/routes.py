from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.deps import csrf_protect, require_roles
from app.brands import service
from app.brands.schemas import BrandDTO, BrandUpdate, dto_from_orm
from app.exceptions import DomainError

admin_router = APIRouter(prefix="/api/admin/brands", tags=["admin-brands"])


@admin_router.get("", response_model=list[BrandDTO], dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def admin_list_brands():
    rows = service.list_brands_ordered()
    return [dto_from_orm(r) for r in rows]


@admin_router.put(
    "/{brand_id}",
    response_model=BrandDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def admin_update_brand(brand_id: str, payload: BrandUpdate):
    try:
        return service.update_brand(brand_id, payload)
    except DomainError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=e.message) from e
