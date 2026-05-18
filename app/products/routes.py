from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm.exc import DetachedInstanceError
from starlette.responses import Response

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.config import settings
from app.exceptions import DomainError
from app.products import service
from app.storage import printing_artwork_service as printing_artwork_service
from app.products.schemas import (
    CreateProductRequest,
    CreateProductVersionRequest,
    UpdateProductRequest,
    SpecPayload,
)
router = APIRouter(prefix="/api/products", tags=["products"])


def _printing_artwork_http_error(e: DomainError) -> None:
    m = (e.message or "").lower()
    if "not configured" in m:
        raise HTTPException(status_code=503, detail=e.message)
    raise HTTPException(status_code=400, detail=e.message)


def _product_version_count(p) -> int:
    """Version count for list/detail summaries (batch-set on list; or loaded `versions` relationship)."""
    explicit = getattr(p, "_version_count", None)
    if explicit is not None:
        return int(explicit)
    try:
        vd = p.__dict__.get("versions")
        if vd is not None:
            return len(vd)
    except Exception:
        pass
    return 0


def _product_summary(p) -> dict:
    # NOTE: Some code paths return ORM objects after their session has closed.
    # Accessing lazy relationships (like p.customer) on a detached instance raises
    # DetachedInstanceError. We defensively avoid crashing responses here.
    try:
        customer_name = getattr(getattr(p, "customer", None), "name", None)
    except DetachedInstanceError:
        customer_name = None

    spec = None
    try:
        spec = getattr(getattr(p, "active_version", None), "spec_payload", None)
    except DetachedInstanceError:
        spec = None

    active_version_number = None
    try:
        active_version_number = getattr(getattr(p, "active_version", None), "version_number", None)
    except DetachedInstanceError:
        active_version_number = None

    identity = spec.get("identity") if isinstance(spec, dict) else None
    packaging = spec.get("packaging") if isinstance(spec, dict) else None
    product_type = identity.get("product_type") if isinstance(identity, dict) else None
    finish_mode = identity.get("finish_mode") if isinstance(identity, dict) else None
    pack_mode = packaging.get("pack_mode") if isinstance(packaging, dict) else None
    computed_desc = service.compute_product_description(spec) if isinstance(spec, dict) else None

    return {
        "id": p.id,
        "code": p.code,
        "description": computed_desc or getattr(p, "description", None),
        "customer_id": p.customer_id,
        "active_version_id": p.active_version_id,
        "active_version_number": active_version_number,
        "version_count": _product_version_count(p),
        "created_at": str(getattr(p, "created_at", "")),
        "customer_name": customer_name,
        "product_type": product_type,
        "finish_mode": finish_mode,
        "pack_mode": pack_mode,
        "production_extruder_code": getattr(p, "production_extruder_code", None),
        "die_size": getattr(p, "die_size", None),
        "default_qty_type": getattr(p, "default_qty_type", None),
        "last_order_defaults": getattr(p, "_last_order_defaults", None),
    }


def _version_summary(v) -> dict:
    return {
        "id": v.id,
        "product_id": v.product_id,
        "version_number": v.version_number,
        "created_by": v.created_by,
        "created_at": str(getattr(v, "created_at", "")),
        "spec_payload": v.spec_payload,
        "description": service.compute_product_description(v.spec_payload) if isinstance(v.spec_payload, dict) else None,
    }


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_products(
    q: Optional[str] = Query(default=None),
    customer_id: Optional[str] = Query(default=None),
):
    products = service.search_products(q, customer_id=customer_id)
    return {"items": [_product_summary(p) for p in products]}


@router.get("/code-exists", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def product_code_exists(
    code: str = Query(..., min_length=1),
    customer_id: str = Query(..., min_length=1),
):
    try:
        cid = str(uuid.UUID(customer_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid customer_id")
    return {"exists": service.product_code_exists(code, customer_id=cid)}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_product(payload: CreateProductRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        product, version = service.create_product_with_version(payload, created_by=created_by)
        setattr(product, "_version_count", 1)
        return {"ok": True, "product": _product_summary(product), "version": _version_summary(version)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/{product_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_product(product_id: str):
    p = service.get_with_versions(product_id)
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return {
        "product": _product_summary(p),
        "versions": [_version_summary(v) for v in (p.versions or [])],
        "usage": service.product_usage(product_id),
    }


@router.delete(
    "/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def delete_product(product_id: str):
    try:
        service.delete_product(product_id)
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{product_id}/versions/{version_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_version(product_id: str, version_id: str):
    v = service.get_version(version_id)
    if not v:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Version not found")
    spec = SpecPayload(**v.spec_payload) if v.spec_payload else None
    routing = service.derive_operation_routing(spec) if spec else {"operations": [], "warnings": []}
    return {"version": _version_summary(v), "routing": routing}


@router.post(
    "/{product_id}/versions/{version_id}/printing-artwork",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def upload_product_printing_artwork(product_id: str, version_id: str, file: UploadFile = File(...)):
    try:
        data = await file.read()
        out = printing_artwork_service.upload_product_printing_pdf(
            product_id=product_id,
            version_id=version_id,
            filename=file.filename or "artwork.pdf",
            data=data,
        )
        return {"ok": True, "file": out}
    except DomainError as e:
        _printing_artwork_http_error(e)


@router.get(
    "/{product_id}/versions/{version_id}/printing-artwork/{file_id}/download-url",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))],
)
async def product_printing_artwork_download_url(product_id: str, version_id: str, file_id: str):
    try:
        url = printing_artwork_service.presign_product_printing_pdf(
            product_id=product_id,
            version_id=version_id,
            file_id=file_id,
        )
        return {"url": url, "expires_in": int(getattr(settings, "S3_PRINTING_ARTWORK_URL_TTL_SECONDS", 900) or 900)}
    except DomainError as e:
        _printing_artwork_http_error(e)


@router.delete(
    "/{product_id}/versions/{version_id}/printing-artwork/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def delete_product_printing_artwork(product_id: str, version_id: str, file_id: str):
    try:
        printing_artwork_service.delete_product_printing_pdf(
            product_id=product_id,
            version_id=version_id,
            file_id=file_id,
        )
    except DomainError as e:
        _printing_artwork_http_error(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{product_id}/versions", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def create_product_version(product_id: str, payload: CreateProductVersionRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        v = service.create_new_version(product_id, payload, created_by=created_by)
        return {"ok": True, "version": _version_summary(v)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.put("/{product_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_product(product_id: str, payload: UpdateProductRequest):
    try:
        p = service.update_product(product_id, payload)
        return {"ok": True, "product": _product_summary(p)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)
