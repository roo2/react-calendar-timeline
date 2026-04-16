from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from starlette.responses import Response

from app.auth.deps import allow_roles_any, csrf_protect, current_identity
from app.config import settings
from app.db.models.domain import Order, OrderItem
from app.db.session import SessionLocal
from app.exceptions import DomainError
from app.job_sheets import service
from app.job_sheets.schemas import (
    JobSheetCreateRequest,
    JobSheetDetail,
    JobSheetSummary,
    JobSheetUpdateRequest,
)
from app.storage import printing_artwork_service as printing_artwork_service

router = APIRouter(prefix="/api/job-sheets", tags=["job_sheets"])


def _printing_artwork_http_error(e: DomainError) -> None:
    m = (e.message or "").lower()
    if "not configured" in m:
        raise HTTPException(status_code=503, detail=e.message)
    raise HTTPException(status_code=400, detail=e.message)


def _order_info_for_job_sheets(job_sheet_ids: list[str]) -> dict[str, tuple[str | None, str | None, str | None]]:
    """Return map job_sheet_id -> (order_id, order_code, order_date). Prefer most recently created order if multiple."""
    if not job_sheet_ids:
        return {}
    out: dict[str, tuple[str | None, str | None, str | None]] = {}
    with SessionLocal() as db:
        rows = (
            db.query(OrderItem.job_sheet_id, Order.id, Order.code, Order.order_date)
            .join(Order, Order.id == OrderItem.order_id)
            .filter(OrderItem.job_sheet_id.in_(job_sheet_ids))
            .order_by(Order.created_at.desc())
            .all()
        )
        for jid, oid, code, order_date in rows:
            jid_s = str(jid)
            if jid_s in out:
                continue
            out[jid_s] = (str(oid), code, str(order_date) if order_date is not None else None)
    return out


def _to_summary(js, order_info: tuple[str | None, str | None, str | None] | None = None) -> JobSheetSummary:
    product = getattr(js, "product", None)
    customer = getattr(js, "customer", None)
    version = getattr(js, "version", None)
    order_id = None
    invoice_no = None
    order_date = None
    if order_info:
        order_id, invoice_no, order_date = order_info
    return JobSheetSummary(
        id=js.id,
        job_no=js.job_no,
        job_seq=int(getattr(js, "job_seq", 0) or 0),
        customer_id=js.customer_id,
        product_id=js.product_id,
        product_version_id=js.product_version_id,
        version_number=int(getattr(version, "version_number", 0) or 0),
        due_date=str(js.due_date.date()) if getattr(js, "due_date", None) is not None else None,
        quantity_value=float(js.quantity_value),
        quantity_unit=js.quantity_unit,
        qty_type=str(getattr(js, "qty_type", None) or "kg"),
        num_product_units=float(js.num_product_units) if getattr(js, "num_product_units", None) is not None else None,
        weight_per_roll_kg=float(js.weight_per_roll_kg) if getattr(js, "weight_per_roll_kg", None) is not None else None,
        num_rolls=int(getattr(js, "num_rolls", None) or 1),
        created_by=js.created_by,
        created_at=str(getattr(js, "created_at", "")) if getattr(js, "created_at", None) else None,
        product_code=getattr(product, "code", ""),
        product_description=getattr(product, "description", None),
        customer_name=getattr(customer, "name", None),
        customer_code=getattr(customer, "code", None),
        order_id=order_id,
        invoice_no=invoice_no,
        order_date=order_date,
    )


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_job_sheets(customer_id: str | None = Query(default=None)):
    rows = service.list_job_sheets(customer_id=customer_id)
    ids = [r.id for r in rows]
    order_map = _order_info_for_job_sheets(ids)
    return {"items": [_to_summary(r, order_map.get(r.id)).model_dump() for r in rows]}


@router.get("/next-job-no", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def next_job_no(customer_id: str = Query(...)):
    try:
        job_no = service.suggest_next_job_no(customer_id)
        return {"job_no": job_no}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_job_sheet(payload: JobSheetCreateRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        job_sheet_id = service.create_job_sheet_with_new_version(payload, created_by=created_by)
        full = service.get_job_sheet(job_sheet_id)
        assert full is not None
        order_map = _order_info_for_job_sheets([full.id])
        return {"ok": True, "job_sheet": _to_summary(full, order_map.get(full.id)).model_dump()}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/{job_sheet_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_job_sheet(job_sheet_id: str):
    js = service.get_job_sheet(job_sheet_id)
    if not js:
        raise HTTPException(status_code=404, detail="Job sheet not found")
    order_map = _order_info_for_job_sheets([js.id])
    order_info = order_map.get(js.id)
    spec = getattr(getattr(js, "version", None), "spec_payload", None) or {}
    out = JobSheetDetail(job_sheet=_to_summary(js, order_info), spec_payload=spec)
    return out.model_dump()


@router.put("/{job_sheet_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_job_sheet(job_sheet_id: str, payload: JobSheetUpdateRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        updated_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        jid = service.update_job_sheet(job_sheet_id, payload, updated_by=updated_by)
        full = service.get_job_sheet(jid)
        assert full is not None
        order_map = _order_info_for_job_sheets([jid])
        return {"ok": True, "job_sheet": _to_summary(full, order_map.get(jid)).model_dump()}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post(
    "/{job_sheet_id}/printing-artwork",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def upload_job_sheet_printing_artwork(job_sheet_id: str, file: UploadFile = File(...)):
    try:
        data = await file.read()
        out = printing_artwork_service.upload_job_sheet_printing_pdf(
            job_sheet_id=job_sheet_id,
            filename=file.filename or "artwork.pdf",
            data=data,
        )
        return {"ok": True, "file": out}
    except DomainError as e:
        _printing_artwork_http_error(e)


@router.get(
    "/{job_sheet_id}/printing-artwork/{file_id}/download-url",
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))],
)
async def job_sheet_printing_artwork_download_url(job_sheet_id: str, file_id: str):
    try:
        url = printing_artwork_service.presign_job_sheet_printing_pdf(job_sheet_id=job_sheet_id, file_id=file_id)
        return {"url": url, "expires_in": int(getattr(settings, "S3_PRINTING_ARTWORK_URL_TTL_SECONDS", 900) or 900)}
    except DomainError as e:
        _printing_artwork_http_error(e)


@router.delete(
    "/{job_sheet_id}/printing-artwork/{file_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def delete_job_sheet_printing_artwork(job_sheet_id: str, file_id: str):
    try:
        printing_artwork_service.delete_job_sheet_printing_pdf(job_sheet_id=job_sheet_id, file_id=file_id)
    except DomainError as e:
        _printing_artwork_http_error(e)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

