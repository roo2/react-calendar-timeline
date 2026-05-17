from __future__ import annotations

import copy
import re
import uuid
from datetime import date, datetime, time, timezone
from typing import Optional, List, Any, Dict

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.db.myob_import_placeholders import (
    MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID,
    MYOB_DRAFT_PLACEHOLDER_VERSION_ID,
)
from app.db.models.domain import Customer, Product, ProductVersion, JobSheet, Job, Order, OrderItem
from app.db.models.enums import OrderStatus
from app.exceptions import DomainError
from app.job_context import ensure_scheduling_job_for_job_sheet
from app.job_production_timestamps import apply_job_production_timestamps


def _utc_aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)
from app.products.service import (
    _next_version_number,
    compute_product_code_full,
    compute_product_description,
    create_product_v1_in_session,
)  # reuse version numbering helper
from app.job_sheets.schemas import JobSheetCreateRequest, JobSheetUpdateRequest


def _ensure_customer_exists(db, customer_id: str) -> str:
    try:
        cid = str(uuid.UUID(customer_id))
    except Exception as e:
        raise DomainError("Invalid customer_id") from e
    if not db.get(Customer, cid):
        raise DomainError("Customer not found")
    return cid


def _ensure_product_exists(db, product_id: str) -> str:
    try:
        pid = str(uuid.UUID(product_id))
    except Exception as e:
        raise DomainError("Invalid product_id") from e
    if not db.get(Product, pid):
        raise DomainError("Product not found")
    return pid


def _job_no_prefix_for_customer(customer: Customer) -> str:
    """
    Prefix for job_no (globally unique). Uses a short slug from the customer name plus
    part of the customer UUID so two customers with similar names do not collide.
    """
    name = (getattr(customer, "name", None) or "").strip().upper()
    alnum = re.sub(r"[^A-Z0-9]+", "", name)
    base = (alnum[:12] if alnum else "CUST")[:12]
    uid_s = str(getattr(customer, "id", "") or "").replace("-", "")
    suffix = (uid_s[:4] or "0000").upper()
    return f"{base}-{suffix}"


def _next_job_seq(db, customer_id: str) -> int:
    current = db.scalar(select(func.max(JobSheet.job_seq)).where(JobSheet.customer_id == customer_id)) or 0
    return int(current) + 1


def _new_draft_order_code() -> str:
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def _norm_job_sheet_extruder(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = str(v).strip()
    if not t:
        return None
    return t[:64]


def _norm_job_sheet_die_size(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    t = str(v).strip()
    return t if t else None


def _next_order_line_index(db, order_id: str) -> int:
    m = db.scalar(select(func.max(OrderItem.line_index)).where(OrderItem.order_id == str(order_id)))
    return int(m if m is not None else -1) + 1


def sync_job_numbers_for_order(db, order_id: str) -> None:
    """
    Recompute job numbers for all job-sheet-backed order lines as:
      {invoice_number}_{1-based-line-counter}
    where invoice_number is ``orders.code``.
    """
    o = db.get(Order, str(order_id))
    if o is None:
        return
    invoice = str(getattr(o, "code", "") or "").strip()
    if not invoice:
        return
    items = (
        db.execute(
            select(OrderItem)
            .where(OrderItem.order_id == str(o.id), OrderItem.job_sheet_id.is_not(None))
            .order_by(OrderItem.line_index.asc(), OrderItem.id.asc())
        )
        .scalars()
        .all()
    )
    for i, oi in enumerate(items, start=1):
        jsid = getattr(oi, "job_sheet_id", None)
        if not jsid:
            continue
        js = db.get(JobSheet, str(jsid))
        if js is None:
            continue
        js.job_no = f"{invoice}_{i}"
        db.add(js)
    db.flush()


def _ensure_draft_order_for_job_sheet_in_db(db, job_sheet_id: str, *, new_order_date: Optional[date] = None) -> str:
    """
    If no order line exists for this job sheet, create a DRAFT order with one line.
    Returns the order id (existing or newly created).
    """
    existing = db.scalar(select(OrderItem).where(OrderItem.job_sheet_id == str(job_sheet_id)))
    if existing is not None:
        return str(existing.order_id)
    js = db.get(JobSheet, str(job_sheet_id))
    if not js:
        raise DomainError("Job sheet not found")
    od = new_order_date if new_order_date is not None else date.today()
    order = Order(
        code=_new_draft_order_code(),
        customer_id=str(js.customer_id),
        product_version_id=str(js.product_version_id),
        status=OrderStatus.DRAFT,
        order_date=od,
    )
    db.add(order)
    db.flush()
    li = _next_order_line_index(db, str(order.id))
    db.add(OrderItem(order_id=str(order.id), job_sheet_id=str(js.id), line_index=li))
    db.flush()
    return str(order.id)


def suggest_next_job_no(customer_id: str) -> str:
    """
    Suggest the next job number for a customer.

    Format: {NAME_SLUG}-{UUID4}_{seq}, where seq is 1 + max existing seq for that customer.
    """
    with SessionLocal() as db:
        cid = _ensure_customer_exists(db, customer_id)
        cust = db.get(Customer, cid)
        assert cust is not None
        prefix = _job_no_prefix_for_customer(cust)
        seq = _next_job_seq(db, cid)
        return f"{prefix}_{seq}"


def create_job_sheet_with_new_version(payload: JobSheetCreateRequest, created_by: str) -> str:
    with SessionLocal.begin() as db:
        cid = _ensure_customer_exists(db, payload.customer_id)
        pid = _ensure_product_exists(db, payload.product_id)

        cust = db.get(Customer, cid)
        assert cust is not None
        prefix = _job_no_prefix_for_customer(cust)

        product = db.get(Product, pid)
        assert product is not None
        if product.customer_id != cid:
            raise DomainError("Product does not belong to selected customer")

        vnum = _next_version_number(db, pid)
        version = ProductVersion(
            product_id=pid,
            version_number=vnum,
            created_by=created_by or "system",
            spec_payload=payload.spec.dict(),
        )
        db.add(version)
        db.flush()

        product.active_version_id = version.id
        db.add(product)

        # Ensure product code matches the linked version spec payload.
        if isinstance(getattr(version, "spec_payload", None), dict):
            new_code = compute_product_code_full(product, version.spec_payload)
            if new_code and new_code != getattr(product, "code", None):
                product.code = new_code
                db.add(product)

        create_fields = payload.model_dump(exclude_unset=True)
        if "production_extruder_code" in create_fields or "die_size" in create_fields:
            if "production_extruder_code" in create_fields:
                product.production_extruder_code = _norm_job_sheet_extruder(payload.production_extruder_code)
            if "die_size" in create_fields:
                product.die_size = _norm_job_sheet_die_size(payload.die_size)
            db.add(product)

        due_dt: Optional[datetime] = None
        if payload.due_date is not None:
            due_dt = datetime.combine(payload.due_date, time.min)

        cfd: Optional[str] = None
        if payload.customer_facing_description is not None:
            t = str(payload.customer_facing_description).strip()
            cfd = t or None

        # Allocate a per-customer sequence; retry on unique conflict (rare, but possible).
        js: Optional[JobSheet] = None
        last_err: Optional[Exception] = None
        for _ in range(5):
            seq = _next_job_seq(db, cid)
            job_no = f"{prefix}_{seq}"
            try:
                with db.begin_nested():
                    js = JobSheet(
                        job_no=job_no,
                        job_seq=seq,
                        customer_id=cid,
                        product_id=pid,
                        product_version_id=version.id,
                        due_date=due_dt,
                        quantity_value=float(payload.quantity_value),
                        quantity_unit=str(payload.quantity_unit),
                        qty_type=str(payload.qty_type),
                        num_product_units=payload.num_product_units,
                        weight_per_roll_kg=payload.weight_per_roll_kg,
                        num_rolls=int(payload.num_rolls),
                        created_by=created_by or "system",
                        customer_facing_description=cfd,
                    )
                    db.add(js)
                    db.flush()
                last_err = None
                break
            except IntegrityError as e:
                last_err = e
                js = None
                continue
        if js is None:
            raise DomainError("Failed to allocate job number") from last_err

        _ensure_draft_order_for_job_sheet_in_db(db, str(js.id), new_order_date=payload.order_date)
        oi = db.scalar(select(OrderItem).where(OrderItem.job_sheet_id == str(js.id)))
        if oi is not None:
            sync_job_numbers_for_order(db, str(oi.order_id))
        job = ensure_scheduling_job_for_job_sheet(db, str(js.id))
        if job is None:
            raise DomainError("Could not create production job for job sheet")
        upd = payload.model_dump(exclude_unset=True)
        if "production_status" in upd and payload.production_status is not None:
            job.status = payload.production_status
            apply_job_production_timestamps(job, job.status)
        if "production_started_at" in upd:
            job.production_started_at = _utc_aware(payload.production_started_at)
        if "production_finished_at" in upd:
            job.production_finished_at = _utc_aware(payload.production_finished_at)
        db.add(job)
        db.flush()

        # IMPORTANT: capture ID before session closes/attributes expire
        return str(js.id)


def create_job_sheet_from_product_latest_version(
    *,
    db,
    customer_id: str,
    product_id: str,
    due_date: Optional[datetime],
    quantity_value: float,
    quantity_unit: str,
    created_by: str,
    unit_rate: Optional[float] = None,
    line_total: Optional[float] = None,
    qty_type: Optional[str] = None,
    num_product_units: Optional[float] = None,
    weight_per_roll_kg: Optional[float] = None,
    num_rolls: Optional[int] = None,
) -> JobSheet:
    """
    Create a job sheet that references the product's *current active version*.
    Intended for inline Order creation.
    """
    cid = _ensure_customer_exists(db, customer_id)
    pid = _ensure_product_exists(db, product_id)

    cust = db.get(Customer, cid)
    assert cust is not None
    prefix = _job_no_prefix_for_customer(cust)

    product = db.get(Product, pid)
    assert product is not None
    if product.customer_id != cid:
        raise DomainError("Product does not belong to selected customer")
    if not product.active_version_id:
        raise DomainError("Product has no active version")

    qt, npu0, wpr0, nr0 = _infer_qty_fields_for_order_line(
        float(quantity_value), str(quantity_unit), qty_type, num_rolls
    )
    qu_l = str(quantity_unit).lower()
    if qu_l == "cartons" and num_product_units is None:
        pv_obj = db.get(ProductVersion, str(product.active_version_id))
        bpc = 0
        if pv_obj and isinstance(getattr(pv_obj, "spec_payload", None), dict):
            pack = (pv_obj.spec_payload or {}).get("packaging") or {}
            try:
                bpc = int(pack.get("bags_per_carton") or 0)
            except (TypeError, ValueError):
                bpc = 0
        if bpc > 0:
            npu0 = float(quantity_value) * float(bpc)
    npu = float(num_product_units) if num_product_units is not None else npu0
    wpr = float(weight_per_roll_kg) if weight_per_roll_kg is not None else wpr0

    js: Optional[JobSheet] = None
    last_err: Optional[Exception] = None
    for _ in range(5):
        seq = _next_job_seq(db, cid)
        job_no = f"{prefix}_{seq}"
        try:
            with db.begin_nested():
                js = JobSheet(
                    job_no=job_no,
                    job_seq=seq,
                    customer_id=cid,
                    product_id=pid,
                    product_version_id=str(product.active_version_id),
                    due_date=due_date,
                    quantity_value=float(quantity_value),
                    quantity_unit=str(quantity_unit),
                    qty_type=qt,
                    num_product_units=npu,
                    weight_per_roll_kg=wpr,
                    num_rolls=int(nr0),
                    unit_rate=float(unit_rate) if unit_rate is not None else None,
                    line_total=float(line_total) if line_total is not None else None,
                    created_by=created_by or "system",
                )
                db.add(js)
                db.flush()
            last_err = None
            break
        except IntegrityError as e:
            last_err = e
            js = None
            continue
    if js is None:
        raise DomainError("Failed to allocate job number") from last_err
    return js


def create_myob_import_draft_job_sheet(
    *,
    db,
    customer_id: str,
    quantity_value: float,
    quantity_unit: str,
    qty_type: str,
    unit_rate: Optional[float],
    line_total: Optional[float],
    created_by: str,
) -> JobSheet:
    """
    Create a job sheet for a MYOB import line: real order customer, placeholder product/version, qty/price
    from MYOB. Does not create a production ``Job`` row (``is_import_draft``) until the sheet is completed.
    """
    cid = _ensure_customer_exists(db, str(customer_id))
    cust = db.get(Customer, cid)
    assert cust is not None
    prefix = _job_no_prefix_for_customer(cust)
    pv = db.get(ProductVersion, str(MYOB_DRAFT_PLACEHOLDER_VERSION_ID))
    if not pv or str(pv.product_id) != str(MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID):
        raise DomainError("MYOB draft placeholder product/version is not installed (run migrations)")

    qt, npu0, wpr0, nr0 = _infer_qty_fields_for_order_line(
        float(quantity_value), str(quantity_unit), qty_type, None
    )
    npu = float(npu0) if npu0 is not None else None
    wpr = float(wpr0) if wpr0 is not None else None

    js: Optional[JobSheet] = None
    last_err: Optional[Exception] = None
    for _ in range(5):
        seq = _next_job_seq(db, cid)
        job_no = f"{prefix}_{seq}"
        try:
            with db.begin_nested():
                js = JobSheet(
                    job_no=job_no,
                    job_seq=seq,
                    customer_id=cid,
                    product_id=str(MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID),
                    product_version_id=str(MYOB_DRAFT_PLACEHOLDER_VERSION_ID),
                    due_date=None,
                    quantity_value=float(quantity_value),
                    quantity_unit=str(quantity_unit),
                    qty_type=qt,
                    num_product_units=npu,
                    weight_per_roll_kg=wpr,
                    num_rolls=int(nr0),
                    unit_rate=float(unit_rate) if unit_rate is not None else None,
                    line_total=float(line_total) if line_total is not None else None,
                    created_by=created_by or "system",
                    is_import_draft=True,
                )
                db.add(js)
                db.flush()
            last_err = None
            break
        except IntegrityError as e:
            last_err = e
            js = None
            continue
    if js is None:
        raise DomainError("Failed to allocate job number for MYOB import draft") from last_err
    return js


def _infer_qty_fields_for_order_line(
    quantity_value: float,
    quantity_unit: str,
    qty_type: Optional[str],
    num_rolls: Optional[int],
) -> tuple[str, Optional[float], Optional[float], int]:
    """Defaults for job sheets created from orders when extended fields are not passed."""
    qu = str(quantity_unit).lower()
    if qty_type:
        qt = str(qty_type)
    elif qu == "rolls":
        qt = "total_rolls"
    elif qu == "kg":
        qt = "kg"
    elif qu == "1000":
        qt = "units"
    elif qu in ("bags", "meters", "cartons"):
        qt = "units"
    else:
        qt = "kg"
    nr = num_rolls if num_rolls is not None and int(num_rolls) >= 1 else None
    if nr is None:
        if qt == "total_rolls" or qu == "rolls":
            nr = max(1, int(round(float(quantity_value))))
        else:
            nr = 1
    npu: Optional[float]
    if qt == "units":
        # Order line unit "1000": quantity_value is thousands of products.
        npu = float(quantity_value) * 1000.0 if qu == "1000" else float(quantity_value)
    else:
        npu = None
    return qt, npu, None, int(nr)


def _spec_identity_dimensions(spec: Any) -> tuple[dict, dict]:
    if not isinstance(spec, dict):
        return {}, {}
    ident = spec.get("identity") if isinstance(spec.get("identity"), dict) else {}
    dims = spec.get("dimensions") if isinstance(spec.get("dimensions"), dict) else {}
    return ident, dims


def list_job_sheets(
    customer_id: Optional[str] = None,
    *,
    product_type: Optional[str] = None,
    printed: Optional[str] = None,
    finish_mode: Optional[str] = None,
    width_min_mm: Optional[float] = None,
    width_max_mm: Optional[float] = None,
    length_min_mm: Optional[float] = None,
    length_max_mm: Optional[float] = None,
    gauge_min_um: Optional[float] = None,
    gauge_max_um: Optional[float] = None,
    search: Optional[str] = None,
) -> tuple[List[JobSheet], int]:
    pt_f = (product_type or "").strip().casefold()
    printed_f = (printed or "").strip().casefold()
    finish_mode_f = (finish_mode or "").strip().casefold()
    q_f = (search or "").strip().casefold()
    with SessionLocal() as db:
        stmt = (
            select(JobSheet)
            .options(joinedload(JobSheet.product))
            .options(joinedload(JobSheet.customer))
            .options(joinedload(JobSheet.version))
            .order_by(JobSheet.created_at.desc())
        )
        if customer_id:
            stmt = stmt.where(JobSheet.customer_id == str(customer_id))
        rows = list(db.scalars(stmt).all())

        # Lazily repair old stored product codes based on the spec_payload of the linked version.
        changed = False
        seen_product_ids: set[str] = set()
        for js in rows:
            p = getattr(js, "product", None)
            v = getattr(js, "version", None)
            if not p or not v:
                continue
            pid = str(getattr(p, "id", ""))
            if not pid or pid in seen_product_ids:
                continue
            seen_product_ids.add(pid)
            if not isinstance(getattr(v, "spec_payload", None), dict):
                continue
            new_code = compute_product_code_full(p, v.spec_payload)
            if new_code and new_code != getattr(p, "code", None):
                p.code = new_code
                db.add(p)
                changed = True

        if changed:
            try:
                db.commit()
            except IntegrityError:
                db.rollback()

        # Optional filters (product geometry / quote-style match) — applied in Python using version spec.
        if not (
            pt_f
            or printed_f
            or finish_mode_f
            or q_f
            or width_min_mm is not None
            or width_max_mm is not None
            or length_min_mm is not None
            or length_max_mm is not None
            or gauge_min_um is not None
            or gauge_max_um is not None
        ):
            return rows, len(rows)

        oi_by_js: dict[str, str] = {}
        if q_f and rows:
            js_ids = [str(x.id) for x in rows]
            for oi in db.execute(select(OrderItem).where(OrderItem.job_sheet_id.in_(js_ids))).scalars().all():
                sid = str(oi.job_sheet_id) if getattr(oi, "job_sheet_id", None) else ""
                if sid and sid not in oi_by_js:
                    oi_by_js[sid] = str(getattr(oi, "import_line_description", "") or "")

        filtered: List[JobSheet] = []
        for js in rows:
            v = getattr(js, "version", None)
            spec = getattr(v, "spec_payload", None) if v else None
            ident, dims = _spec_identity_dimensions(spec)
            if pt_f:
                spt = str(ident.get("product_type") or "").strip().casefold()
                if spt != pt_f:
                    continue
            if finish_mode_f:
                s_finish = str(ident.get("finish_mode") or "").strip().casefold()
                if s_finish != finish_mode_f:
                    continue
            if printed_f:
                pr = spec.get("printing") if isinstance(spec, dict) and isinstance(spec.get("printing"), dict) else {}
                method = str(pr.get("method") or "").strip().casefold()
                if printed_f == "none":
                    if method not in ("", "none"):
                        continue
                elif method != printed_f:
                    continue
            w_raw = dims.get("base_width_mm")
            try:
                wn = float(w_raw) if w_raw is not None else None
            except (TypeError, ValueError):
                wn = None
            if width_min_mm is not None and wn is not None and wn < float(width_min_mm):
                continue
            if width_max_mm is not None and wn is not None and wn > float(width_max_mm):
                continue
            l_raw = dims.get("base_length_mm")
            try:
                ln = float(l_raw) if l_raw is not None else None
            except (TypeError, ValueError):
                ln = None
            if length_min_mm is not None and ln is not None and ln < float(length_min_mm):
                continue
            if length_max_mm is not None and ln is not None and ln > float(length_max_mm):
                continue
            g_raw = dims.get("thickness_um")
            try:
                gn = float(g_raw) if g_raw is not None else None
            except (TypeError, ValueError):
                gn = None
            if gauge_min_um is not None and gn is not None and gn < float(gauge_min_um):
                continue
            if gauge_max_um is not None and gn is not None and gn > float(gauge_max_um):
                continue
            if q_f:
                p = getattr(js, "product", None)
                c = getattr(js, "customer", None)
                v = getattr(js, "version", None)
                spec = getattr(v, "spec_payload", None) if v else None
                code = str(getattr(p, "code", "") or "").casefold()
                desc = str(getattr(p, "description", "") or "").casefold()
                customer_name = str(getattr(c, "name", "") or "").casefold()
                jno = str(getattr(js, "job_no", "") or "").casefold()
                long_desc = ""
                print_desc = ""
                if isinstance(spec, dict):
                    computed = compute_product_description(spec, max_len=None)
                    if computed:
                        long_desc = str(computed).casefold()
                    pr = spec.get("printing") if isinstance(spec.get("printing"), dict) else {}
                    print_desc = str(pr.get("print_description") or "").casefold()
                import_line = str(oi_by_js.get(str(js.id), "")).casefold()
                cface = str(getattr(js, "customer_facing_description", None) or "").casefold()
                blob = f"{code} {desc} {customer_name} {jno} {long_desc} {print_desc} {import_line} {cface}"
                if q_f not in blob:
                    continue
            filtered.append(js)
        return filtered, len(filtered)


def _snap_from_job(job: Job) -> Dict[str, Any]:
    st = job.status
    sv = getattr(st, "value", st)
    ps = job.production_started_at
    pf = job.production_finished_at
    return {
        "status": str(sv),
        "production_started_at": ps.isoformat() if ps is not None else None,
        "production_finished_at": pf.isoformat() if pf is not None else None,
    }


def production_job_snapshots_by_job_sheet_ids(job_sheet_ids: list[str]) -> dict[str, Dict[str, Any]]:
    """
    Map job_sheet_id -> { status, production_started_at, production_finished_at } from the linked Job row.
    Order-backed Jobs use (order_id, job_code); standalone Jobs use job_sheet_id.
    """
    if not job_sheet_ids:
        return {}
    out: dict[str, Dict[str, Any]] = {}
    with SessionLocal() as db:
        for job in db.execute(select(Job).where(Job.job_sheet_id.in_(job_sheet_ids))).scalars().all():
            jsid = getattr(job, "job_sheet_id", None)
            if not jsid:
                continue
            sid = str(jsid)
            if sid not in out:
                out[sid] = _snap_from_job(job)

        ois = list(db.execute(select(OrderItem).where(OrderItem.job_sheet_id.in_(job_sheet_ids))).scalars().all())
        for oi in ois:
            sid = str(oi.job_sheet_id)
            if sid in out:
                continue
            order = db.get(Order, oi.order_id)
            if not order:
                continue
            items = list(
                db.execute(select(OrderItem).where(OrderItem.order_id == order.id).order_by(OrderItem.id.asc())).scalars().all()
            )
            job_code: Optional[int] = None
            for i, row in enumerate(items):
                if str(row.job_sheet_id) == sid:
                    job_code = i + 1
                    break
            if job_code is None:
                continue
            job = db.execute(select(Job).where(Job.order_id == order.id, Job.job_code == job_code)).scalars().first()
            if job:
                out[sid] = _snap_from_job(job)
    return out


def production_job_status_by_job_sheet_ids(job_sheet_ids: list[str]) -> dict[str, str]:
    snap = production_job_snapshots_by_job_sheet_ids(job_sheet_ids)
    return {k: str(v.get("status") or "") for k, v in snap.items()}


def append_printing_artwork_file_to_job_sheet_version(
    job_sheet_id: str,
    *,
    file_id: str,
    filename: str,
    byte_size: int,
) -> None:
    """
    Record a printing PDF in the job sheet's linked ``ProductVersion.spec_payload`` under
    ``printing.artwork_files`` so download-url / delete can resolve the S3 object key.
    """
    with SessionLocal.begin() as db:
        try:
            jid = str(uuid.UUID(str(job_sheet_id)))
        except Exception as e:
            raise DomainError("Invalid job_sheet_id") from e
        js = db.get(JobSheet, jid)
        if not js:
            raise DomainError("Job sheet not found")
        vid = getattr(js, "product_version_id", None)
        if not vid:
            raise DomainError("Job sheet has no product version")
        version = db.get(ProductVersion, str(vid))
        if not version:
            raise DomainError("Product version not found")
        raw = getattr(version, "spec_payload", None)
        if not isinstance(raw, dict):
            raise DomainError("Job sheet has no spec")
        spec = copy.deepcopy(raw)
        printing = spec.get("printing")
        if not isinstance(printing, dict):
            printing = {}
            spec["printing"] = printing
        files = printing.get("artwork_files")
        if not isinstance(files, list):
            files = []
            printing["artwork_files"] = files
        fid_s = str(file_id)
        for it in files:
            if isinstance(it, dict) and str(it.get("id")) == fid_s:
                it["filename"] = str(filename)
                it["byte_size"] = int(byte_size)
                version.spec_payload = spec
                db.add(version)
                return
        files.append({"id": fid_s, "filename": str(filename), "byte_size": int(byte_size)})
        version.spec_payload = spec
        db.add(version)


def remove_printing_artwork_file_from_job_sheet_version(job_sheet_id: str, *, file_id: str) -> None:
    """Remove ``file_id`` from ``printing.artwork_files`` on the job sheet's linked version spec."""
    with SessionLocal.begin() as db:
        try:
            jid = str(uuid.UUID(str(job_sheet_id)))
        except Exception as e:
            raise DomainError("Invalid job_sheet_id") from e
        js = db.get(JobSheet, jid)
        if not js:
            raise DomainError("Job sheet not found")
        vid = getattr(js, "product_version_id", None)
        if not vid:
            return
        version = db.get(ProductVersion, str(vid))
        if not version:
            return
        raw = getattr(version, "spec_payload", None)
        if not isinstance(raw, dict):
            return
        spec = copy.deepcopy(raw)
        printing = spec.get("printing")
        if not isinstance(printing, dict):
            return
        files = printing.get("artwork_files")
        if not isinstance(files, list):
            return
        fid_s = str(file_id)
        printing["artwork_files"] = [it for it in files if not (isinstance(it, dict) and str(it.get("id")) == fid_s)]
        version.spec_payload = spec
        db.add(version)


def get_job_sheet(job_sheet_id: str) -> Optional[JobSheet]:
    with SessionLocal() as db:
        try:
            jid = str(uuid.UUID(job_sheet_id))
        except Exception:
            return None
        stmt = (
            select(JobSheet)
            .options(joinedload(JobSheet.product))
            .options(joinedload(JobSheet.customer))
            .options(joinedload(JobSheet.version))
            .where(JobSheet.id == jid)
        )
        js = db.scalar(stmt)
        if not js:
            return None

        p = getattr(js, "product", None)
        v = getattr(js, "version", None)
        if p and v and isinstance(getattr(v, "spec_payload", None), dict):
            new_code = compute_product_code_full(p, v.spec_payload)
            if new_code and new_code != getattr(p, "code", None):
                p.code = new_code
                db.add(p)
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
        return js


def finalize_import_draft_job_sheet_after_spec_save(db, job_sheet_id: str) -> None:
    """
    After staff save a real spec for a MYOB import draft sheet: clear the draft flag, treat the order line
    as normal production, and ensure a scheduling Job exists (planned).
    """
    try:
        jid = str(uuid.UUID(str(job_sheet_id)))
    except Exception:
        return
    js = db.get(JobSheet, jid)
    if not js or not bool(getattr(js, "is_import_draft", False)):
        return
    js.is_import_draft = False
    db.add(js)
    db.flush()
    oi = db.execute(
        select(OrderItem).where(
            OrderItem.job_sheet_id == str(js.id),
            OrderItem.line_kind == "myob_import",
        )
    ).scalars().first()
    if oi is not None:
        oi.line_kind = "manufactured"
        db.add(oi)
    db.flush()
    ensure_scheduling_job_for_job_sheet(db, str(js.id))


def update_job_sheet(job_sheet_id: str, payload: JobSheetUpdateRequest, *, updated_by: str) -> str:
    with SessionLocal.begin() as db:
        try:
            jid = str(uuid.UUID(job_sheet_id))
        except Exception as e:
            raise DomainError("Invalid job_sheet_id") from e

        js = db.get(JobSheet, jid)
        if not js:
            raise DomainError("Job sheet not found")

        import_draft_before = bool(getattr(js, "is_import_draft", False))

        upd = payload.model_dump(exclude_unset=True)

        # Always apply order-line quantity fields when present (required by schema).
        js.quantity_value = float(payload.quantity_value)
        js.quantity_unit = str(payload.quantity_unit)

        # Extended qty / scheduling fields: only when the client sent them (partial update).
        if "qty_type" in upd and payload.qty_type is not None:
            js.qty_type = str(payload.qty_type)
        if "num_product_units" in upd:
            js.num_product_units = payload.num_product_units
        if "weight_per_roll_kg" in upd:
            js.weight_per_roll_kg = payload.weight_per_roll_kg
        if "num_rolls" in upd:
            if payload.num_rolls is None:
                raise DomainError("num_rolls cannot be null")
            js.num_rolls = int(payload.num_rolls)

        if "due_date" in upd:
            js.due_date = datetime.combine(payload.due_date, time.min) if payload.due_date is not None else None

        if "unit_rate" in upd:
            js.unit_rate = upd["unit_rate"]
        if "line_total" in upd:
            js.line_total = upd["line_total"]

        if "customer_facing_description" in upd:
            v = payload.customer_facing_description
            if v is None:
                js.customer_facing_description = None
            else:
                t = str(v).strip()
                js.customer_facing_description = t if t else None

        # Optionally create a new product version + repoint job sheet
        if payload.spec is not None:
            on_placeholder = str(js.product_id) == str(MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID)
            if import_draft_before and on_placeholder:
                new_product, version = create_product_v1_in_session(
                    db, customer_id=str(js.customer_id), spec=payload.spec, created_by=updated_by
                )
                js.product_id = str(new_product.id)
                js.product_version_id = str(version.id)
            else:
                pid = str(js.product_id)
                vnum = _next_version_number(db, pid)
                spec_payload = (
                    payload.spec.model_dump() if hasattr(payload.spec, "model_dump") else payload.spec.dict()
                )
                version = ProductVersion(
                    product_id=pid,
                    version_number=vnum,
                    created_by=updated_by or "system",
                    spec_payload=spec_payload,
                )
                db.add(version)
                db.flush()

                product = db.get(Product, pid)
                if product:
                    product.active_version_id = version.id
                    if isinstance(getattr(version, "spec_payload", None), dict):
                        new_code = compute_product_code_full(product, version.spec_payload)
                        if new_code and new_code != getattr(product, "code", None):
                            product.code = new_code
                    db.add(product)

                js.product_version_id = str(version.id)

        db.add(js)
        db.flush()
        if payload.spec is not None and import_draft_before:
            finalize_import_draft_job_sheet_after_spec_save(db, str(js.id))

        if ("production_extruder_code" in upd or "die_size" in upd) and str(js.product_id) != str(
            MYOB_DRAFT_PLACEHOLDER_PRODUCT_ID
        ):
            prod = db.get(Product, str(js.product_id))
            if prod:
                if "production_extruder_code" in upd:
                    prod.production_extruder_code = _norm_job_sheet_extruder(payload.production_extruder_code)
                if "die_size" in upd:
                    prod.die_size = _norm_job_sheet_die_size(payload.die_size)
                db.add(prod)

        oid = _ensure_draft_order_for_job_sheet_in_db(db, str(js.id))
        sync_job_numbers_for_order(db, str(oid))
        if "order_date" in upd:
            o = db.get(Order, oid)
            if o:
                o.order_date = payload.order_date
                db.add(o)
                db.flush()

        prod_touch = (
            ("production_status" in upd and payload.production_status is not None)
            or "production_started_at" in upd
            or "production_finished_at" in upd
        )
        if prod_touch:
            job = ensure_scheduling_job_for_job_sheet(db, str(js.id))
            if job is not None:
                if "production_status" in upd and payload.production_status is not None:
                    job.status = payload.production_status
                    apply_job_production_timestamps(job, job.status)
                if "production_started_at" in upd:
                    job.production_started_at = _utc_aware(payload.production_started_at)
                if "production_finished_at" in upd:
                    job.production_finished_at = _utc_aware(payload.production_finished_at)
                db.add(job)
                db.flush()

        return str(js.id)

