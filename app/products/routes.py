from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.exceptions import DomainError
from app.products import service
from app.products.schemas import (
    CreateProductRequest,
    CreateProductVersionRequest,
    SpecPayload,
    compute_derived_dimensions,
)
router = APIRouter(prefix="/api/products", tags=["products"])


def _product_summary(p) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "customer_id": p.customer_id,
        "active_version_id": p.active_version_id,
        "created_at": str(getattr(p, "created_at", "")),
        "customer_name": getattr(getattr(p, "customer", None), "name", None),
    }


def _version_summary(v) -> dict:
    return {
        "id": v.id,
        "product_id": v.product_id,
        "version_number": v.version_number,
        "created_by": v.created_by,
        "created_at": str(getattr(v, "created_at", "")),
        "spec_payload": v.spec_payload,
    }


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_products(q: Optional[str] = Query(default=None)):
    products = service.search_products(q)
    return {"items": [_product_summary(p) for p in products]}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_product(payload: CreateProductRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        product, version = service.create_product_with_version(payload, created_by=created_by)
        return {"ok": True, "product": _product_summary(product), "version": _version_summary(version)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/{product_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_product(product_id: str):
    p = service.get_with_versions(product_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return {"product": _product_summary(p), "versions": [_version_summary(v) for v in (p.versions or [])]}


@router.get("/{product_id}/versions/{version_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_version(product_id: str, version_id: str):
    v = service.get_version(version_id)
    if not v:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    spec = SpecPayload(**v.spec_payload) if v.spec_payload else None
    routing = service.derive_operation_routing(spec) if spec else {"operations": [], "warnings": []}
    return {"version": _version_summary(v), "routing": routing}


@router.post("/{product_id}/versions", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def create_product_version(product_id: str, payload: CreateProductVersionRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        v = service.create_new_version(product_id, payload, created_by=created_by)
        return {"ok": True, "version": _version_summary(v)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post(
    "/preview/dimensions",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR")), Depends(csrf_protect())],
)
async def preview_dimensions(payload: SpecPayload):
    derived = compute_derived_dimensions(payload)
    return {"derived": derived}


