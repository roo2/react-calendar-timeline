from __future__ import annotations

import uuid
from datetime import date, datetime, time
from typing import Any, List, Optional

from sqlalchemy import delete, func, nulls_last, or_, select
from sqlalchemy.orm import joinedload

from app.db.session import SessionLocal
from app.db.models.domain import (
    Order as OrderModel,
    OrderItem as OrderItemModel,
    Job as JobModel,
    Brand,
    Customer,
    ProductVersion,
    Product,
    JobSheet,
    ResellProduct,
    OperationRun,
    RunOutputEntry,
    ExtrusionQueueItem,
    UtecoQueueItem,
    BaggingQueueItem,
    ToolReservation,
    JobQCSummary,
    DispatchRecord,
    InventoryTransaction,
    QCCheck,
    QCReading,
)
from app.db.models.enums import OrderStatus, JobStatus
from app.exceptions import DomainError
from app.job_context import ensure_scheduling_job_for_job_sheet
from app.orders.schemas import (
    CreateOrderRequest,
    CreateJobRequest,
    CreateOrderItemRequest,
    CreateResellOrderLineRequest,
    UpdateOrderRequest,
    UpdateResellOrderLineRequest,
)
from app.job_sheets import service as job_sheets_service
from app.orders.product_line_display import product_code_for_version, product_display_name_for_line

def _require_order_editable(o: OrderModel) -> None:
    """Orders may be edited in any status (e.g. dispatched); reserved for future policy hooks."""
    _ = o
    return


def _new_order_code() -> str:
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def _ensure_customer_exists(db, customer_id: str) -> None:
    try:
        uuid.UUID(str(customer_id))
    except Exception as e:
        raise DomainError("Invalid identifiers") from e
    if not db.get(Customer, str(customer_id)):
        raise DomainError("Customer not found")


def _next_order_line_index(db, order_id: str) -> int:
    m = db.scalar(select(func.max(OrderItemModel.line_index)).where(OrderItemModel.order_id == str(order_id)))
    return int(m if m is not None else -1) + 1


def _job_sheet_extras_from_order_item(it: Any) -> dict[str, Any]:
    extra: dict[str, Any] = {}
    data = it.model_dump() if hasattr(it, "model_dump") else it.dict()
    qt = data.get("qty_type")
    if qt is not None and str(qt).strip():
        extra["qty_type"] = str(qt).strip()
    npu = data.get("num_product_units")
    if npu is not None:
        extra["num_product_units"] = float(npu)
    wpr = data.get("weight_per_roll_kg")
    if wpr is not None:
        try:
            wf = float(wpr)
        except (TypeError, ValueError):
            wf = float("nan")
        if wf == wf and wf > 0:
            extra["weight_per_roll_kg"] = wf
    nr = data.get("num_rolls")
    if nr is not None:
        extra["num_rolls"] = int(nr)
    return extra


def _normalize_resell_quantity_unit(value: str | None) -> str:
    s = (value or "ea").strip().lower()
    if s in ("each", "eaches"):
        return "ea"
    return s or "ea"


def _add_resell_line_core(db, order_id: str, item: CreateResellOrderLineRequest) -> OrderItemModel:
    o = db.get(OrderModel, str(order_id))
    if not o:
        raise DomainError("Order not found")
    rp = db.get(ResellProduct, str(item.resell_product_id))
    if not rp or not bool(rp.active):
        raise DomainError("Resell product not found or inactive")
    ck = str(getattr(rp, "catalog_kind", None) or "supply")
    rp_cust = getattr(rp, "customer_id", None)
    if ck == "outsourced_manufacturing" and rp_cust and str(rp_cust) != str(o.customer_id):
        raise DomainError("That outsourced product belongs to a different customer.")
    qty = float(item.quantity_value)
    rate = float(item.rate) if item.rate is not None else float(rp.unit_price)
    if item.total_price is not None:
        total = float(item.total_price)
    else:
        total = qty * rate
    li = _next_order_line_index(db, str(order_id))
    line = OrderItemModel(
        id=str(uuid.uuid4()),
        order_id=str(order_id),
        line_index=li,
        line_kind="resell",
        job_sheet_id=None,
        resell_product_id=str(rp.id),
        resell_description_snapshot=str(rp.description),
        resell_quantity_value=qty,
        resell_quantity_unit=str(item.quantity_unit or "ea"),
        resell_unit_rate=rate,
        resell_line_total=total,
        resell_due_date=item.due_date,
    )
    db.add(line)
    db.flush()
    db.refresh(line)
    return line


def _next_job_code(db, order_id: str) -> int:
    current = db.scalar(select(func.max(JobModel.job_code)).where(JobModel.order_id == str(order_id)))
    return int(current or 0) + 1


def _order_total_for_filters(o: OrderModel) -> float | None:
    total = 0.0
    any_line = False
    for oi in getattr(o, "items", None) or []:
        kind = getattr(oi, "line_kind", None) or "manufactured"
        if kind == "resell":
            t = getattr(oi, "resell_line_total", None)
            if t is not None:
                total += float(t)
                any_line = True
            continue
        if kind == "myob_import":
            js = getattr(oi, "job_sheet", None)
            if js is not None and getattr(js, "line_total", None) is not None:
                total += float(js.line_total)
                any_line = True
            elif getattr(oi, "import_line_total", None) is not None:
                total += float(oi.import_line_total)
                any_line = True
            continue
        js = getattr(oi, "job_sheet", None)
        if js is not None and getattr(js, "line_total", None) is not None:
            total += float(js.line_total)
            any_line = True
    return total if any_line else None


def order_total_from_orm(o: OrderModel) -> float | None:
    """Sum line totals for list display / sorting (matches OrderListItemDTO.order_total)."""
    total = 0.0
    any_line = False
    for oi in getattr(o, "items", None) or []:
        kind = getattr(oi, "line_kind", None) or "manufactured"
        if kind == "resell":
            t = getattr(oi, "resell_line_total", None)
            if t is not None:
                total += float(t)
                any_line = True
            continue
        if kind == "myob_import":
            js = getattr(oi, "job_sheet", None)
            if js is not None and getattr(js, "line_total", None) is not None:
                total += float(js.line_total)
                any_line = True
            elif getattr(oi, "import_line_total", None) is not None:
                total += float(oi.import_line_total)
                any_line = True
            continue
        js = getattr(oi, "job_sheet", None)
        if js is not None and getattr(js, "line_total", None) is not None:
            total += float(js.line_total)
            any_line = True
    return total if any_line else None


_ORDER_LIST_SORT_FIELDS = frozenset(
    {"invoice", "customer_po", "customer", "order_total", "status", "import_review", "order_date"}
)


def _apply_order_list_sort(orders: List[OrderModel], sort_by: Optional[str], sort_dir: Optional[str]) -> None:
    """In-place stable sort of filtered order rows (list endpoint uses Python-side filters)."""
    key_name = (sort_by or "").strip().casefold()
    if key_name not in _ORDER_LIST_SORT_FIELDS:
        return
    d = (sort_dir or "").strip().casefold()
    reverse = d != "asc"

    def key_fn(o: OrderModel) -> tuple:
        oid = str(o.id)
        if key_name == "invoice":
            return (str(getattr(o, "code", "") or "").casefold(), oid)
        if key_name == "customer_po":
            return (str(getattr(o, "customer_purchase_order_number", "") or "").casefold(), oid)
        if key_name == "customer":
            c = getattr(o, "customer", None)
            return (str(getattr(c, "name", "") or "").casefold(), oid)
        if key_name == "order_total":
            t = order_total_from_orm(o)
            return (t is None, float(t) if t is not None else 0.0, oid)
        if key_name == "status":
            st = str(getattr(getattr(o, "status", None), "value", getattr(o, "status", "")) or "")
            return (st.casefold(), oid)
        if key_name == "import_review":
            src = getattr(o, "import_source", None)
            if not src:
                return (0, "", oid)
            ir = getattr(o, "import_review_status", None)
            s = ir if ir in ("incomplete", "complete") else ""
            return (1, s.casefold(), oid)
        if key_name == "order_date":
            od = getattr(o, "order_date", None)
            ca = getattr(o, "created_at", None)
            if od is not None:
                ts = datetime.combine(od, time.min).timestamp()
                return (0, ts, oid)
            if ca is not None:
                return (0, ca.timestamp(), oid)
            return (1, 0.0, oid)
        raise AssertionError(key_name)

    orders.sort(key=key_fn, reverse=reverse)


def _order_tokens(o: OrderModel) -> str:
    toks: list[str] = []
    toks.append(str(getattr(o, "code", "") or ""))
    toks.append(str(getattr(o, "customer_purchase_order_number", "") or ""))
    c = getattr(o, "customer", None)
    if c is not None:
        toks.append(str(getattr(c, "name", "") or ""))
    for oi in getattr(o, "items", None) or []:
        toks.append(str(getattr(oi, "import_line_description", "") or ""))
        toks.append(str(getattr(oi, "myob_item_name", "") or ""))
        toks.append(str(getattr(oi, "myob_item_number", "") or ""))
        toks.append(str(getattr(oi, "resell_description_snapshot", "") or ""))
        rp = getattr(oi, "resell_product", None)
        if rp is not None:
            toks.append(str(getattr(rp, "description", "") or ""))
        js = getattr(oi, "job_sheet", None)
        if js is not None:
            p = getattr(js, "product", None)
            pv = getattr(js, "version", None)
            if p is not None:
                toks.append(product_code_for_version(p, pv))
                dn = product_display_name_for_line(
                    p=p,
                    pv=pv,
                    js=js,
                    import_line_description=getattr(oi, "import_line_description", None),
                )
                if dn:
                    toks.append(dn)
    return " ".join(toks).casefold()


def list_orders(
    *,
    customer_id: Optional[str] = None,
    brand_id: Optional[str] = None,
    brand_code: Optional[str] = None,
    invoice_number: Optional[str] = None,
    customer_po: Optional[str] = None,
    customer: Optional[str] = None,
    product: Optional[str] = None,
    order_total_min: float | None = None,
    order_total_max: float | None = None,
    status: Optional[str] = None,
    order_date_from: date | None = None,
    order_date_to: date | None = None,
    line_item_search: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
) -> tuple[List[OrderModel], int]:
    with SessionLocal() as db:
        effective_brand_id: str | None = None
        s_bid = (brand_id or "").strip()
        s_bcode = (brand_code or "").strip()
        if s_bid:
            effective_brand_id = s_bid
        elif s_bcode:
            b = db.scalar(select(Brand).where(func.lower(Brand.code) == s_bcode.lower()))
            if b is None:
                return [], 0
            effective_brand_id = str(b.id)

        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.customer))
            .options(joinedload(OrderModel.items).joinedload(OrderItemModel.job_sheet).joinedload(JobSheet.product))
            .options(joinedload(OrderModel.items).joinedload(OrderItemModel.job_sheet).joinedload(JobSheet.version))
            .options(joinedload(OrderModel.items).joinedload(OrderItemModel.resell_product))
            .order_by(nulls_last(OrderModel.order_date.desc()), OrderModel.created_at.desc())
        )
        if effective_brand_id:
            stmt = stmt.where(
                OrderModel.customer_id.in_(select(Customer.id).where(Customer.brand_id == effective_brand_id))
            )
        if customer_id:
            stmt = stmt.where(OrderModel.customer_id == str(customer_id))
        rows = list(db.execute(stmt).unique().scalars().all())

        inv_f = (invoice_number or "").strip().casefold()
        cpo_f = (customer_po or "").strip().casefold()
        cust_f = (customer or "").strip().casefold()
        prod_f = (product or "").strip().casefold()
        total_min = float(order_total_min) if order_total_min is not None else None
        total_max = float(order_total_max) if order_total_max is not None else None
        st_f = (status or "").strip().casefold()
        line_f = (line_item_search or "").strip().casefold()
        all_f = (search or "").strip().casefold()

        out: list[OrderModel] = []
        for o in rows:
            if inv_f and inv_f not in str(getattr(o, "code", "") or "").casefold():
                continue
            if cpo_f and cpo_f not in str(getattr(o, "customer_purchase_order_number", "") or "").casefold():
                continue
            c = getattr(o, "customer", None)
            cust_name = str(getattr(c, "name", "") or "").casefold()
            if cust_f and cust_f not in cust_name:
                continue
            od = getattr(o, "order_date", None)
            if order_date_from is not None and (od is None or od < order_date_from):
                continue
            if order_date_to is not None and (od is None or od > order_date_to):
                continue
            st = str(getattr(getattr(o, "status", None), "value", getattr(o, "status", "")) or "").casefold()
            if st_f and st_f != st:
                continue
            toks = _order_tokens(o)
            if prod_f and prod_f not in toks:
                continue
            if line_f and line_f not in toks:
                continue
            if all_f and all_f not in toks:
                continue
            tot = _order_total_for_filters(o)
            if total_min is not None and (tot is None or float(tot) < total_min):
                continue
            if total_max is not None and (tot is None or float(tot) > total_max):
                continue
            out.append(o)

        _apply_order_list_sort(out, sort_by, sort_dir)

        total = len(out)
        start = max(0, (int(page) - 1) * int(page_size))
        end = start + max(1, int(page_size))
        return out[start:end], total


def create_order(payload: CreateOrderRequest, *, created_by: str) -> OrderModel:
    with SessionLocal.begin() as db:
        customer_id = str(payload.customer_id)
        quote_id = str(payload.quote_id) if payload.quote_id else None

        resell_items = list(payload.resell_items or [])
        if not payload.items and not resell_items:
            raise DomainError("At least one order line is required")

        _ensure_customer_exists(db, customer_id)

        created_job_sheets = []
        for it in payload.items:
            due_dt = None
            if it.due_date is not None:
                due_dt = datetime.combine(it.due_date, time.min)
            js = job_sheets_service.create_job_sheet_from_product_latest_version(
                db=db,
                customer_id=customer_id,
                product_id=str(it.product_id),
                due_date=due_dt,
                quantity_value=float(it.quantity_value),
                quantity_unit=str(it.quantity_unit),
                created_by=created_by or "system",
                unit_rate=float(it.rate) if it.rate is not None else None,
                line_total=float(it.total_price) if it.total_price is not None else None,
                **_job_sheet_extras_from_order_item(it),
            )
            created_job_sheets.append(js)

        code = _new_order_code()
        if payload.invoice_number and str(payload.invoice_number).strip():
            code = str(payload.invoice_number).strip()[:32]
        order_date = None
        if payload.order_date is not None:
            order_date = payload.order_date

        order = OrderModel(
            code=code,
            customer_id=customer_id,
            product_version_id=str(created_job_sheets[0].product_version_id) if created_job_sheets else None,
            quote_id=quote_id,
            status=OrderStatus.DRAFT,
            customer_purchase_order_number=(
                str(payload.customer_purchase_order_number).strip()[:128]
                if payload.customer_purchase_order_number and str(payload.customer_purchase_order_number).strip()
                else None
            ),
            order_date=order_date,
        )
        db.add(order)
        db.flush()

        for i, js in enumerate(created_job_sheets):
            oi = OrderItemModel(
                order_id=str(order.id),
                job_sheet_id=str(js.id),
                line_index=i,
                line_kind="manufactured",
            )
            db.add(oi)

        db.flush()
        for js in created_job_sheets:
            job_sheets_service.assign_order_job_no(db, str(order.id), js)
        for rit in resell_items:
            _add_resell_line_core(db, str(order.id), rit)

        db.flush()
        for js in created_job_sheets:
            ensure_scheduling_job_for_job_sheet(db, str(js.id))
        db.refresh(order)
        return order


def get_detail(order_id: str) -> Optional[OrderModel]:
    with SessionLocal() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.jobs))
            .options(joinedload(OrderModel.items).joinedload(OrderItemModel.job_sheet))
            .options(joinedload(OrderModel.items).joinedload(OrderItemModel.resell_product))
            .options(joinedload(OrderModel.customer))
            .where(OrderModel.id == str(order_id))
        )
        return db.execute(stmt).unique().scalars().first()


def create_job(order_id: str, payload: CreateJobRequest) -> JobModel:
    with SessionLocal() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        oid = str(order_id)
        order = db.get(OrderModel, oid)
        if not order:
            raise DomainError("Order not found")
        next_code = _next_job_code(db, oid)
        job = JobModel(
            order_id=oid,
            job_code=next_code,
            planned_qty=payload.planned_qty,
            allocated_order_units=payload.allocated_order_units,
            produced_qty=0,
            status=JobStatus.PLANNED,
        )
        db.add(job)
        db.commit()
        db.refresh(job)
        return job


def update_order(order_id: str, payload: UpdateOrderRequest) -> OrderModel:
    updates = payload.model_dump(exclude_unset=True)
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        needs_editable = bool(
            {"invoice_number", "customer_purchase_order_number", "order_date", "status"} & set(updates.keys())
        )
        if needs_editable:
            _require_order_editable(o)
        if "invoice_number" in updates:
            code = str(payload.invoice_number or "").strip()
            o.code = code[:32] if code else o.code
        if "customer_purchase_order_number" in updates:
            cpo = str(payload.customer_purchase_order_number or "").strip()
            o.customer_purchase_order_number = cpo[:128] if cpo else None
        if "order_date" in updates:
            o.order_date = payload.order_date
        if "status" in updates:
            raw = str(payload.status or "").strip().lower()
            try:
                o.status = OrderStatus(raw)
            except ValueError as e:
                allowed = ", ".join(sorted({x.value for x in OrderStatus}))
                raise DomainError(f"Invalid order status (expected one of: {allowed})") from e
        if "import_review_status" in updates:
            irs = payload.import_review_status
            if irs is None:
                o.import_review_status = None
            else:
                s = str(irs).strip().lower()
                if s not in ("incomplete", "complete"):
                    raise DomainError("import_review_status must be 'incomplete' or 'complete'")
                o.import_review_status = s
        db.add(o)
        db.flush()
        db.refresh(o)
        return o


def publish_order(order_id: str) -> OrderModel:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be published")
        o.status = OrderStatus.CONFIRMED
        db.add(o)
        db.flush()
        db.refresh(o)
        return o


def add_order_item(order_id: str, item: CreateOrderItemRequest, *, created_by: str) -> OrderItemModel:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)

        due_dt = None
        if item.due_date is not None:
            due_dt = datetime.combine(item.due_date, time.min)

        js = job_sheets_service.create_job_sheet_from_product_latest_version(
            db=db,
            customer_id=str(o.customer_id),
            product_id=str(item.product_id),
            due_date=due_dt,
            quantity_value=float(item.quantity_value),
            quantity_unit=str(item.quantity_unit),
            created_by=created_by or "system",
            unit_rate=float(item.rate) if item.rate is not None else None,
            line_total=float(item.total_price) if item.total_price is not None else None,
            **_job_sheet_extras_from_order_item(item),
        )

        oi = OrderItemModel(
            order_id=str(o.id),
            job_sheet_id=str(js.id),
            line_index=_next_order_line_index(db, str(o.id)),
            line_kind="manufactured",
        )
        db.add(oi)

        if not getattr(o, "product_version_id", None) and getattr(js, "product_version_id", None):
            o.product_version_id = str(js.product_version_id)
            db.add(o)

        db.flush()
        job_sheets_service.assign_order_job_no(db, str(o.id), js)
        ensure_scheduling_job_for_job_sheet(db, str(js.id))
        db.refresh(oi)
        return oi


def remove_order_item(order_id: str, order_item_id: str) -> None:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(order_item_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)

        oi = db.get(OrderItemModel, str(order_item_id))
        if not oi or str(oi.order_id) != str(o.id):
            raise DomainError("Order item not found")
        if oi.line_kind not in ("manufactured", "myob_import"):
            raise DomainError("Use the resell line remove endpoint for resell items")

        old_js_id = str(oi.job_sheet_id) if oi.job_sheet_id else None
        oi_js = db.get(JobSheet, old_js_id) if old_js_id else None
        db.delete(oi)
        db.flush()

        # Keep orphaned job sheets (and their job_no) for printed references and suffix allocation.

        rows = (
            db.query(OrderItemModel, JobSheet)
            .join(JobSheet, JobSheet.id == OrderItemModel.job_sheet_id)
            .filter(OrderItemModel.order_id == str(o.id), OrderItemModel.line_kind == "manufactured")
            .order_by(OrderItemModel.line_index.asc(), JobSheet.job_seq.asc(), JobSheet.id.asc())
            .all()
        )
        if rows:
            _, js0 = rows[0]
            o.product_version_id = str(getattr(js0, "product_version_id", None)) if js0 else None
        else:
            o.product_version_id = None
        db.add(o)
        db.flush()


def add_order_resell_line(order_id: str, item: CreateResellOrderLineRequest, *, created_by: str) -> OrderItemModel:
    _ = created_by
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)
        return _add_resell_line_core(db, str(o.id), item)


def remove_order_resell_line(order_id: str, line_id: str) -> None:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(line_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)
        ln = db.get(OrderItemModel, str(line_id))
        if not ln or str(ln.order_id) != str(o.id) or ln.line_kind != "resell":
            raise DomainError("Order line not found")
        db.delete(ln)
        db.flush()


def update_order_resell_line(order_id: str, line_id: str, payload: UpdateResellOrderLineRequest) -> OrderItemModel:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(line_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)
        ln = db.get(OrderItemModel, str(line_id))
        if not ln or str(ln.order_id) != str(o.id) or ln.line_kind != "resell":
            raise DomainError("Order line not found")
        data = payload.model_dump(exclude_unset=True)
        if "quantity_value" in data and data["quantity_value"] is not None:
            ln.resell_quantity_value = float(data["quantity_value"])
        if "quantity_unit" in data and data["quantity_unit"] is not None:
            ln.resell_quantity_unit = _normalize_resell_quantity_unit(str(data["quantity_unit"]))
        if "due_date" in data:
            ln.resell_due_date = data["due_date"]
        if "rate" in data:
            ln.resell_unit_rate = float(data["rate"]) if data["rate"] is not None else None
        if "total_price" in data and data["total_price"] is not None:
            ln.resell_line_total = float(data["total_price"])
        elif "total_price" in data and data.get("total_price") is None:
            ln.resell_line_total = None
        if "total_price" not in data:
            ur = ln.resell_unit_rate
            if ur is not None and ln.resell_quantity_value is not None:
                ln.resell_line_total = float(ln.resell_quantity_value) * float(ur)
        db.add(ln)
        db.flush()
        db.refresh(ln)
        return ln


def convert_resell_line_to_myob_import_job_sheet(order_id: str, line_id: str, *, created_by: str) -> OrderItemModel:
    """
    Turn a MYOB-imported **resell** line (wrong ``IsBought`` / catalog classification) into a ``myob_import`` line
    that requires a job sheet, and attach a fresh import-draft job sheet (same as MYOB re-import path).

    Requires MYOB row identifiers on the line (``myob_item_uid`` and/or ``myob_row_id``) and a positive import qty.
    """
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(line_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)
        oi = db.get(OrderItemModel, str(line_id))
        if not oi or str(oi.order_id) != str(o.id):
            raise DomainError("Order line not found")
        if str(getattr(oi, "line_kind", "") or "") != "resell":
            raise DomainError("Only resell lines can be converted")

        rp_id = getattr(oi, "resell_product_id", None)
        if rp_id:
            rp = db.get(ResellProduct, str(rp_id))
            if rp is not None and str(getattr(rp, "catalog_kind", None) or "") != "outsourced_manufacturing":
                raise DomainError(
                    "Only outsourced manufacturing resell lines can be converted to a job sheet. "
                    "Supply resell lines (pallets, cores, fees, etc.) stay on the order without a job sheet."
                )

        uid = str(getattr(oi, "myob_item_uid", None) or "").strip()
        rid = getattr(oi, "myob_row_id", None)
        if not uid and rid is None:
            raise DomainError("This resell line has no MYOB identifiers; convert is only for MYOB-imported rows")

        # Backfill import columns from resell if an older row missed them.
        if getattr(oi, "import_ship_quantity", None) is None and getattr(oi, "resell_quantity_value", None) is not None:
            oi.import_ship_quantity = float(oi.resell_quantity_value)
        if not getattr(oi, "import_quantity_unit", None) and getattr(oi, "resell_quantity_unit", None):
            oi.import_quantity_unit = str(oi.resell_quantity_unit)
        if getattr(oi, "import_unit_price", None) is None and getattr(oi, "resell_unit_rate", None) is not None:
            oi.import_unit_price = float(oi.resell_unit_rate)
        if getattr(oi, "import_line_total", None) is None and getattr(oi, "resell_line_total", None) is not None:
            oi.import_line_total = float(oi.resell_line_total)
        if not getattr(oi, "import_line_description", None) and getattr(oi, "resell_description_snapshot", None):
            oi.import_line_description = str(oi.resell_description_snapshot)
        if not getattr(oi, "import_qty_type", None):
            oi.import_qty_type = "kg"
        if not getattr(oi, "myob_line_type", None):
            oi.myob_line_type = "Transaction"

        qty = float(oi.import_ship_quantity or 0.0)
        if not (qty > 0):
            raise DomainError("Shipment quantity must be positive to create a MYOB import job sheet draft")

        oi.resell_product_id = None
        oi.resell_description_snapshot = None
        oi.resell_quantity_value = None
        oi.resell_quantity_unit = None
        oi.resell_unit_rate = None
        oi.resell_line_total = None
        oi.resell_due_date = None

        oi.line_kind = "myob_import"
        oi.import_requires_job_sheet = True
        oi.job_sheet_id = None

        js = job_sheets_service.create_myob_import_draft_job_sheet(
            db=db,
            customer_id=str(o.customer_id),
            quantity_value=qty,
            quantity_unit=str(oi.import_quantity_unit or "kg"),
            qty_type=str(oi.import_qty_type or "kg"),
            unit_rate=float(oi.import_unit_price) if oi.import_unit_price is not None else None,
            line_total=float(oi.import_line_total) if oi.import_line_total is not None else None,
            created_by=(created_by or "system").strip() or "system",
        )
        oi.job_sheet_id = str(js.id)
        db.add(oi)
        db.flush()
        job_sheets_service.assign_order_job_no(db, str(o.id), js)
        db.refresh(oi)
        return oi


def link_myob_import_line_job_sheet(order_id: str, line_id: str, job_sheet_id: str) -> None:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(line_id))
            uuid.UUID(str(job_sheet_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        _require_order_editable(o)
        oi = db.get(OrderItemModel, str(line_id))
        if not oi or str(oi.order_id) != str(order_id) or oi.line_kind != "myob_import":
            raise DomainError("MYOB import line not found")
        new_js = db.get(JobSheet, str(job_sheet_id))
        if not new_js:
            raise DomainError("Job sheet not found")
        if str(new_js.customer_id) != str(o.customer_id):
            raise DomainError("Job sheet must belong to the same customer as the order")

        old_id = str(oi.job_sheet_id) if oi.job_sheet_id else None
        old_js = db.get(JobSheet, old_id) if old_id else None
        oi.job_sheet_id = str(new_js.id)
        db.add(oi)
        db.flush()

        if old_js and bool(getattr(old_js, "is_import_draft", False)) and str(old_js.id) != str(new_js.id):
            n = db.scalar(
                select(func.count()).select_from(OrderItemModel).where(OrderItemModel.job_sheet_id == str(old_js.id))
            )
            if int(n or 0) == 0:
                db.delete(old_js)
        db.flush()
        job_sheets_service.assign_order_job_no(db, str(o.id), new_js)

        _ = ensure_scheduling_job_for_job_sheet(db, str(new_js.id))


def _order_status_value(o: OrderModel) -> str:
    st = getattr(o, "status", None)
    return str(getattr(st, "value", st) or "").strip().lower()


def _purge_jobs_for_order_delete(db, job_ids: list[str]) -> None:
    if not job_ids:
        return
    ids = [str(x) for x in job_ids]
    db.execute(delete(ExtrusionQueueItem).where(ExtrusionQueueItem.job_id.in_(ids)))
    db.execute(delete(UtecoQueueItem).where(UtecoQueueItem.job_id.in_(ids)))
    db.execute(delete(BaggingQueueItem).where(BaggingQueueItem.job_id.in_(ids)))
    db.execute(delete(ToolReservation).where(ToolReservation.job_id.in_(ids)))
    run_ids = list(db.scalars(select(OperationRun.id).where(OperationRun.job_id.in_(ids))).all())
    if run_ids:
        db.execute(delete(RunOutputEntry).where(RunOutputEntry.run_id.in_(run_ids)))
        db.execute(
            delete(InventoryTransaction).where(
                or_(InventoryTransaction.job_id.in_(ids), InventoryTransaction.run_id.in_(run_ids))
            )
        )
        db.execute(delete(QCCheck).where(QCCheck.operation_run_id.in_(run_ids)))
        db.execute(delete(QCReading).where(QCReading.operation_run_id.in_(run_ids)))
        db.execute(delete(OperationRun).where(OperationRun.id.in_(run_ids)))
    else:
        db.execute(delete(InventoryTransaction).where(InventoryTransaction.job_id.in_(ids)))
    db.execute(delete(JobQCSummary).where(JobQCSummary.job_id.in_(ids)))
    db.execute(delete(DispatchRecord).where(DispatchRecord.job_id.in_(ids)))
    db.execute(delete(JobModel).where(JobModel.id.in_(ids)))
    db.flush()


def delete_order(order_id: str) -> None:
    """Permanently remove a draft order and its lines, job sheets, and production jobs."""
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        oid = str(order_id)
        o = db.get(OrderModel, oid)
        if not o:
            raise DomainError("Order not found")
        if _order_status_value(o) != OrderStatus.DRAFT.value:
            raise DomainError("Only draft orders can be deleted")

        items = list(db.scalars(select(OrderItemModel).where(OrderItemModel.order_id == oid)).all())
        js_ids = sorted({str(it.job_sheet_id) for it in items if getattr(it, "job_sheet_id", None)})

        job_id_stmt = select(JobModel.id).where(JobModel.order_id == oid)
        if js_ids:
            job_id_stmt = job_id_stmt.union(select(JobModel.id).where(JobModel.job_sheet_id.in_(js_ids)))
        job_ids = list(db.scalars(job_id_stmt).all())

        db.execute(delete(DispatchRecord).where(DispatchRecord.order_id == oid))
        _purge_jobs_for_order_delete(db, job_ids)
        db.execute(delete(OrderItemModel).where(OrderItemModel.order_id == oid))
        db.flush()

        for jsid in js_ids:
            n = db.scalar(select(func.count()).select_from(OrderItemModel).where(OrderItemModel.job_sheet_id == jsid))
            if int(n or 0) == 0:
                js = db.get(JobSheet, jsid)
                if js is not None:
                    db.delete(js)
        db.flush()
        db.delete(o)
