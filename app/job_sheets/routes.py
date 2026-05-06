from __future__ import annotations

from datetime import date

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


def _job_sheet_extruder_for_summary(v) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t[:64] if t else None


def _job_sheet_die_for_summary(v) -> str | None:
    if v is None:
        return None
    t = str(v).strip()
    return t if t else None


def _printing_artwork_http_error(e: DomainError) -> None:
    m = (e.message or "").lower()
    if "not configured" in m:
        raise HTTPException(status_code=503, detail=e.message)
    raise HTTPException(status_code=400, detail=e.message)


def _order_info_for_job_sheets(
    job_sheet_ids: list[str],
) -> dict[str, tuple[str | None, str | None, str | None, str | None]]:
    """Return map job_sheet_id -> (order_id, order_code, order_date, order_status). Prefer most recently created order if multiple."""
    if not job_sheet_ids:
        return {}
    out: dict[str, tuple[str | None, str | None, str | None, str | None]] = {}
    with SessionLocal() as db:
        rows = (
            db.query(OrderItem.job_sheet_id, Order.id, Order.code, Order.order_date, Order.status)
            .join(Order, Order.id == OrderItem.order_id)
            .filter(OrderItem.job_sheet_id.in_(job_sheet_ids))
            .order_by(Order.created_at.desc())
            .all()
        )
        for jid, oid, code, order_date, ost in rows:
            jid_s = str(jid)
            if jid_s in out:
                continue
            st_s: str | None = None
            if ost is not None:
                st_s = str(getattr(ost, "value", ost))
            out[jid_s] = (str(oid), code, str(order_date) if order_date is not None else None, st_s)
    return out


def _pretty_status_token(s: str | None) -> str | None:
    if not s:
        return None
    t = str(s).strip()
    if not t:
        return None
    return t.replace("_", " ").title()


def _pretty_production_status(s: str | None) -> str | None:
    """Human label for job production status (API values stay snake_case)."""
    if not s:
        return None
    t = str(s).strip().lower()
    if not t:
        return None
    if t == "planned":
        return "Backlog"
    return t.replace("_", " ").title()


def _status_label(order_status: str | None, production_status: str | None) -> str | None:
    parts: list[str] = []
    o = _pretty_status_token(order_status)
    p = _pretty_production_status(production_status)
    if o:
        parts.append(f"Order: {o}")
    if p:
        parts.append(f"Production: {p}")
    return " · ".join(parts) if parts else None


def _totals_kg_for_price(js, spec: dict) -> float | None:
    """Prefer calculator snapshot on the version spec; fall back to quantity when unit is kg."""
    qtk = spec.get("quoted_totals_kg")
    if isinstance(qtk, (int, float)) and float(qtk) > 0:
        return float(qtk)
    qu = str(getattr(js, "quantity_unit", "") or "").lower()
    if qu == "kg":
        v = float(getattr(js, "quantity_value", 0) or 0)
        return v if v > 0 else None
    return None


def _price_per_kg(line_total: float | None, totals_kg: float | None) -> float | None:
    if line_total is None or totals_kg is None or totals_kg <= 0:
        return None
    return float(line_total) / float(totals_kg)


def _to_summary(
    js,
    order_info: tuple[str | None, str | None, str | None, str | None] | None = None,
    *,
    production_snapshot: dict | None = None,
) -> JobSheetSummary:
    product = getattr(js, "product", None)
    customer = getattr(js, "customer", None)
    version = getattr(js, "version", None)
    spec: dict = {}
    if version and isinstance(getattr(version, "spec_payload", None), dict):
        spec = version.spec_payload  # type: ignore[assignment]
    order_id = None
    invoice_no = None
    order_date = None
    order_status = None
    if order_info:
        order_id, invoice_no, order_date, order_status = order_info
    lt = float(js.line_total) if getattr(js, "line_total", None) is not None else None
    ur = float(js.unit_rate) if getattr(js, "unit_rate", None) is not None else None
    tkg = _totals_kg_for_price(js, spec)
    ppk = _price_per_kg(lt, tkg)
    snap = production_snapshot or {}
    ps_raw = snap.get("status")
    production_status = None if ps_raw is None else str(ps_raw)
    psa = snap.get("production_started_at")
    pfa = snap.get("production_finished_at")
    production_started_at = None if psa is None else str(psa)
    production_finished_at = None if pfa is None else str(pfa)
    return JobSheetSummary(
        id=js.id,
        job_no=js.job_no,
        job_seq=int(getattr(js, "job_seq", 0) or 0),
        customer_id=js.customer_id,
        product_id=js.product_id,
        product_version_id=js.product_version_id,
        version_number=int(getattr(version, "version_number", 0) or 0),
        is_import_draft=bool(getattr(js, "is_import_draft", False)),
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
        order_id=order_id,
        invoice_no=invoice_no,
        order_date=order_date,
        order_status=order_status,
        production_status=production_status,
        production_started_at=production_started_at,
        production_finished_at=production_finished_at,
        status_label=_status_label(order_status, production_status),
        unit_rate=ur,
        line_total=lt,
        price_per_kg=ppk,
        customer_facing_description=str(getattr(js, "customer_facing_description", None) or "").strip() or None,
        production_extruder_code=_job_sheet_extruder_for_summary(
            getattr(product, "production_extruder_code", None) if product else None
        ),
        die_size=_job_sheet_die_for_summary(getattr(product, "die_size", None) if product else None),
    )


_JOB_SHEET_LIST_SORT_FIELDS = frozenset(
    {"invoice_no", "customer", "product", "status", "order_date", "qty", "price_per_kg", "line_total"}
)


def _job_sheet_order_date_sort_tuple(order_date_s: str | None) -> tuple[int, float]:
    if not order_date_s:
        return (1, 0.0)
    try:
        d0 = date.fromisoformat(str(order_date_s)[:10])
        return (0, float(d0.toordinal()))
    except Exception:
        return (1, 0.0)


def _job_sheet_list_sort_tuple(
    js,
    order_map: dict[str, tuple[str | None, str | None, str | None, str | None]],
    snap_map: dict[str, dict],
    sort_by: str,
) -> tuple:
    oid = str(js.id)
    oi = order_map.get(oid)
    _, inv, od_s, ost = oi if oi else (None, None, None, None)
    snap = snap_map.get(oid) or {}
    ps_raw = snap.get("status")
    prod_stat = None if ps_raw is None else str(ps_raw)
    status_label = _status_label(ost, prod_stat) or ""
    version = getattr(js, "version", None)
    spec: dict = {}
    if version and isinstance(getattr(version, "spec_payload", None), dict):
        spec = version.spec_payload  # type: ignore[assignment]
    product = getattr(js, "product", None)
    customer = getattr(js, "customer", None)

    if sort_by == "invoice_no":
        return ((inv or "").casefold(), oid)
    if sort_by == "customer":
        return ((getattr(customer, "name", None) or "").casefold(), oid)
    if sort_by == "product":
        code = str(getattr(product, "code", "") or "").casefold()
        desc = str(getattr(product, "description", "") or "").casefold()
        return (code, desc, oid)
    if sort_by == "status":
        return (status_label.casefold(), oid)
    if sort_by == "order_date":
        return (*_job_sheet_order_date_sort_tuple(od_s), oid)
    if sort_by == "qty":
        qv = float(getattr(js, "quantity_value", 0) or 0)
        return (qv, oid)
    if sort_by == "line_total":
        lt = getattr(js, "line_total", None)
        return (lt is None, float(lt) if lt is not None else 0.0, oid)
    if sort_by == "price_per_kg":
        lt_f = float(js.line_total) if getattr(js, "line_total", None) is not None else None
        tkg = _totals_kg_for_price(js, spec)
        ppk = _price_per_kg(lt_f, tkg)
        return (ppk is None, float(ppk) if ppk is not None else 0.0, oid)
    raise AssertionError(sort_by)


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_job_sheets(
    customer_id: str | None = Query(default=None),
    product_type: str | None = Query(default=None),
    printed: str | None = Query(default=None),
    finish_mode: str | None = Query(default=None),
    width_min_mm: float | None = Query(default=None),
    width_max_mm: float | None = Query(default=None),
    length_min_mm: float | None = Query(default=None),
    length_max_mm: float | None = Query(default=None),
    gauge_min_um: float | None = Query(default=None),
    gauge_max_um: float | None = Query(default=None),
    from_date: date | None = Query(default=None),
    to_date: date | None = Query(default=None),
    order_status: str | None = Query(default=None),
    production_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sort_by: str | None = Query(
        default=None,
        description=(
            "Sort field: invoice_no, customer, product, status, order_date, qty, price_per_kg, line_total"
        ),
    ),
    sort_dir: str | None = Query(default=None, description="asc or desc"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
):
    rows, total = service.list_job_sheets(
        customer_id=customer_id,
        product_type=product_type,
        printed=printed,
        finish_mode=finish_mode,
        width_min_mm=width_min_mm,
        width_max_mm=width_max_mm,
        length_min_mm=length_min_mm,
        length_max_mm=length_max_mm,
        gauge_min_um=gauge_min_um,
        gauge_max_um=gauge_max_um,
        search=search,
    )
    ids_all = [r.id for r in rows]
    order_map_all = _order_info_for_job_sheets(ids_all)
    os_f = (order_status or "").strip().casefold()
    ps_f = (production_status or "").strip().casefold()
    if from_date is not None or to_date is not None or os_f or ps_f:
        prod_map_all = service.production_job_status_by_job_sheet_ids([str(i) for i in ids_all]) if ps_f else {}
        filtered_rows = []
        for r in rows:
            _, _, od_s, os_s = order_map_all.get(str(r.id), (None, None, None, None))
            if from_date is not None or to_date is not None:
                if not od_s:
                    continue
                try:
                    od = date.fromisoformat(str(od_s))
                except Exception:
                    continue
                if from_date is not None and od < from_date:
                    continue
                if to_date is not None and od > to_date:
                    continue
            if os_f:
                if str(os_s or "").strip().casefold() != os_f:
                    continue
            if ps_f:
                ps_s = str(prod_map_all.get(str(r.id), "") or "").strip().casefold()
                if ps_s != ps_f:
                    continue
            filtered_rows.append(r)
        rows = filtered_rows
        total = len(filtered_rows)

    sort_key = (sort_by or "").strip().casefold()
    if sort_key in _JOB_SHEET_LIST_SORT_FIELDS:
        ids_sort = [str(r.id) for r in rows]
        order_map_sort = _order_info_for_job_sheets(ids_sort)
        snap_map_sort = service.production_job_snapshots_by_job_sheet_ids(ids_sort)
        ascending = (sort_dir or "").strip().casefold() == "asc"
        rows.sort(
            key=lambda r: _job_sheet_list_sort_tuple(r, order_map_sort, snap_map_sort, sort_key),
            reverse=not ascending,
        )

    start = (page - 1) * page_size
    end = start + page_size
    page_rows = rows[start:end]
    ids = [r.id for r in page_rows]
    order_map = {str(i): order_map_all.get(str(i), (None, None, None, None)) for i in ids}
    snap_map = service.production_job_snapshots_by_job_sheet_ids([str(i) for i in ids])
    return {
        "items": [
            _to_summary(r, order_map.get(str(r.id)), production_snapshot=snap_map.get(str(r.id))).model_dump()
            for r in page_rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


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
        order_map = _order_info_for_job_sheets([str(full.id)])
        prod_map = service.production_job_status_by_job_sheet_ids([str(full.id)])
        return {
            "ok": True,
            "job_sheet": _to_summary(
                full, order_map.get(str(full.id)), production_status=prod_map.get(str(full.id))
            ).model_dump(),
        }
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/{job_sheet_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def get_job_sheet(job_sheet_id: str):
    js = service.get_job_sheet(job_sheet_id)
    if not js:
        raise HTTPException(status_code=404, detail="Job sheet not found")
    order_map = _order_info_for_job_sheets([str(js.id)])
    snap_map = service.production_job_snapshots_by_job_sheet_ids([str(js.id)])
    order_info = order_map.get(str(js.id))
    spec = getattr(getattr(js, "version", None), "spec_payload", None) or {}
    myob_desc: str | None = None
    with SessionLocal() as db:
        oi = (
            db.query(OrderItem)
            .filter(OrderItem.job_sheet_id == str(js.id))
            .order_by(OrderItem.line_index.asc(), OrderItem.id.asc())
            .first()
        )
        if oi is not None and getattr(oi, "import_line_description", None):
            d = str(oi.import_line_description).strip()
            myob_desc = d or None
    out = JobSheetDetail(
        job_sheet=_to_summary(js, order_info, production_snapshot=snap_map.get(str(js.id))),
        spec_payload=spec,
        myob_import_line_description=myob_desc,
    )
    return out.model_dump()


@router.put("/{job_sheet_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_job_sheet(job_sheet_id: str, payload: JobSheetUpdateRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        updated_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        jid = service.update_job_sheet(job_sheet_id, payload, updated_by=updated_by)
        full = service.get_job_sheet(jid)
        assert full is not None
        order_map = _order_info_for_job_sheets([str(jid)])
        snap_map = service.production_job_snapshots_by_job_sheet_ids([str(jid)])
        return {
            "ok": True,
            "job_sheet": _to_summary(
                full, order_map.get(str(jid)), production_snapshot=snap_map.get(str(jid))
            ).model_dump(),
        }
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

