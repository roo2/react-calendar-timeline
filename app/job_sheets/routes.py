from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import allow_roles_any, csrf_protect, current_identity
from app.db.session import SessionLocal
from app.db.models.domain import Order, OrderItem
from app.exceptions import DomainError
from app.job_sheets import service
from app.job_sheets.schemas import JobSheetCreateRequest, JobSheetUpdateRequest, JobSheetSummary, JobSheetDetail


router = APIRouter(prefix="/api/job-sheets", tags=["job_sheets"])


def _order_info_for_job_sheets(job_sheet_ids: list[str]) -> dict[str, tuple[str | None, str | None]]:
    """Return map job_sheet_id -> (invoice_no, order_date)."""
    if not job_sheet_ids:
        return {}
    out = {}
    with SessionLocal() as db:
        rows = (
            db.query(OrderItem.job_sheet_id, Order.code, Order.order_date)
            .join(Order, Order.id == OrderItem.order_id)
            .filter(OrderItem.job_sheet_id.in_(job_sheet_ids))
            .all()
        )
        for jid, code, order_date in rows:
            out[jid] = (code, str(order_date) if order_date is not None else None)
    return out


def _to_summary(js, order_info: tuple[str | None, str | None] | None = None) -> JobSheetSummary:
    product = getattr(js, "product", None)
    customer = getattr(js, "customer", None)
    version = getattr(js, "version", None)
    invoice_no = None
    order_date = None
    if order_info:
        invoice_no, order_date = order_info
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
        created_by=js.created_by,
        created_at=str(getattr(js, "created_at", "")) if getattr(js, "created_at", None) else None,
        product_code=getattr(product, "code", ""),
        product_description=getattr(product, "description", None),
        customer_name=getattr(customer, "name", None),
        customer_code=getattr(customer, "code", None),
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
        # Re-read with joins for summary/spec (new sheet not on an order yet)
        full = service.get_job_sheet(job_sheet_id)
        assert full is not None
        return {"ok": True, "job_sheet": _to_summary(full, None).model_dump()}
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

