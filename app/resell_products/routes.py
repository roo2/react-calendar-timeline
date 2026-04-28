from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect as sa_inspect
from sqlalchemy.orm.base import NO_VALUE

from app.auth.deps import allow_roles_any, csrf_protect, require_roles
from app.exceptions import DomainError
from app.resell_products import service
from app.resell_products.schemas import ResellProductCreate, ResellProductDTO, ResellProductUpdate
from app.str_norm import strip_trailing_dash_suffix

router = APIRouter(prefix="/api/admin/resell-products", tags=["admin-resell-products"])


def _to_dto(r) -> ResellProductDTO:
    # Avoid lazy-loading `income_account` on detached instances (e.g. after create_row).
    lv = sa_inspect(r).attrs.income_account.loaded_value
    ia = None if lv is NO_VALUE else lv
    return ResellProductDTO(
        id=str(r.id),
        description=strip_trailing_dash_suffix(str(r.description)),
        unit_price=r.unit_price if isinstance(r.unit_price, Decimal) else Decimal(str(r.unit_price)),
        active=bool(r.active),
        catalog_kind=str(getattr(r, "catalog_kind", None) or "supply"),
        customer_id=str(r.customer_id) if getattr(r, "customer_id", None) else None,
        myob_item_uid=getattr(r, "myob_item_uid", None),
        myob_income_account_uid=getattr(r, "myob_income_account_uid", None),
        income_account_display_id=getattr(ia, "display_id", None) if ia is not None else None,
        income_account_name=getattr(ia, "name", None) if ia is not None else None,
    )


@router.get("", response_model=list[ResellProductDTO], dependencies=[Depends(require_roles("SYS_ADMIN"))])
async def admin_list_resell_products(include_inactive: bool = True):
    rows = service.list_all(include_inactive=include_inactive)
    return [_to_dto(r) for r in rows]


@router.post("", response_model=ResellProductDTO, dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def admin_create_resell_product(payload: ResellProductCreate):
    try:
        r = service.create_row(payload)
        return _to_dto(r)
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.patch(
    "/{resell_product_id}",
    response_model=ResellProductDTO,
    dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())],
)
async def admin_update_resell_product(resell_product_id: str, payload: ResellProductUpdate):
    try:
        uuid.UUID(str(resell_product_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")
    try:
        r = service.update_row(resell_product_id, payload)
        return _to_dto(r)
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/{resell_product_id}", dependencies=[Depends(require_roles("SYS_ADMIN")), Depends(csrf_protect())])
async def admin_delete_resell_product(resell_product_id: str):
    try:
        uuid.UUID(str(resell_product_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid id")
    try:
        service.delete_row(resell_product_id)
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)
    except Exception:
        raise HTTPException(status_code=400, detail="Cannot delete: may be referenced by orders")


# Public list for order entry (active only)
public_router = APIRouter(prefix="/api/resell-products", tags=["resell-products"])


@public_router.get("", response_model=list[ResellProductDTO], dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_active_resell_products():
    rows = service.list_active()
    return [_to_dto(r) for r in rows]
