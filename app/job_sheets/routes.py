from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import allow_roles_any, csrf_protect, current_identity
from app.exceptions import DomainError
from app.job_sheets import service
from app.job_sheets.schemas import JobSheetCreateRequest, JobSheetSummary, JobSheetDetail


router = APIRouter(prefix="/api/job-sheets", tags=["job_sheets"])


def _to_summary(js) -> JobSheetSummary:
    product = getattr(js, "product", None)
    customer = getattr(js, "customer", None)
    version = getattr(js, "version", None)
    return JobSheetSummary(
        id=js.id,
        job_no=js.job_no,
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
    )


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_job_sheets(customer_id: str | None = Query(default=None)):
    rows = service.list_job_sheets(customer_id=customer_id)
    return {"items": [_to_summary(r).model_dump() for r in rows]}


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
        # Re-read with joins for summary/spec
        full = service.get_job_sheet(job_sheet_id)
        assert full is not None
        return {"ok": True, "job_sheet": _to_summary(full).model_dump()}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/{job_sheet_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_job_sheet(job_sheet_id: str):
    js = service.get_job_sheet(job_sheet_id)
    if not js:
        raise HTTPException(status_code=404, detail="Job sheet not found")
    spec = getattr(getattr(js, "version", None), "spec_payload", None) or {}
    out = JobSheetDetail(job_sheet=_to_summary(js), spec_payload=spec)
    return out.model_dump()

