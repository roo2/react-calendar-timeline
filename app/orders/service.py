from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Any, List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.db.session import SessionLocal
from app.db.models.domain import (
    Order as OrderModel,
    OrderItem as OrderItemModel,
    OrderResellLine,
    Job as JobModel,
    Customer,
    ProductVersion,
    JobSheet,
    ResellProduct,
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


def _new_order_code() -> str:
    # Keep human-readable, unique, and short (orders.code is VARCHAR(32)).
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def _ensure_customer_exists(db, customer_id: str) -> None:
    # Validate UUID formats early (but keep DB keys as strings)
    try:
        uuid.UUID(str(customer_id))
    except Exception as e:
        raise DomainError("Invalid identifiers") from e

    # Validate customer exists
    if not db.get(Customer, str(customer_id)):
        raise DomainError("Customer not found")


def _job_sheet_extras_from_order_item(it: Any) -> dict[str, Any]:
    """Optional qty fields for create_job_sheet_from_product_latest_version (e.g. quote → order)."""
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
        if wf == wf and wf > 0:  # finite and positive (reject NaN)
            extra["weight_per_roll_kg"] = wf
    nr = data.get("num_rolls")
    if nr is not None:
        extra["num_rolls"] = int(nr)
    return extra


def _add_resell_line_core(db, order_id: str, item: CreateResellOrderLineRequest) -> OrderResellLine:
    rp = db.get(ResellProduct, str(item.resell_product_id))
    if not rp or not bool(rp.active):
        raise DomainError("Resell product not found or inactive")
    qty = float(item.quantity_value)
    rate = float(item.rate) if item.rate is not None else float(rp.unit_price)
    if item.total_price is not None:
        total = float(item.total_price)
    else:
        total = qty * rate
    line = OrderResellLine(
        id=str(uuid.uuid4()),
        order_id=str(order_id),
        resell_product_id=str(rp.id),
        description_snapshot=str(rp.description),
        quantity_value=qty,
        quantity_unit=str(item.quantity_unit or "ea"),
        unit_rate=rate,
        line_total=total,
        due_date=item.due_date,
    )
    db.add(line)
    db.flush()
    db.refresh(line)
    return line


def _next_job_code(db, order_id: str) -> int:
    current = db.scalar(select(func.max(JobModel.job_code)).where(JobModel.order_id == str(order_id)))
    return int(current or 0) + 1


def list_orders(*, customer_id: Optional[str] = None) -> List[OrderModel]:
    with SessionLocal() as db:
        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.customer))
            .options(joinedload(OrderModel.items))
            .order_by(OrderModel.created_at.desc())
        )
        if customer_id:
            stmt = stmt.where(OrderModel.customer_id == str(customer_id))
        # joinedload(Order.items) is a collection eager load; Result must be de-duped.
        return list(db.execute(stmt).unique().scalars().all())


def create_order(payload: CreateOrderRequest, *, created_by: str) -> OrderModel:
    """
    Create an Order in DRAFT state and create its Job Sheets inline.
    Each item becomes a Job Sheet referencing the product's latest active version.
    """
    with SessionLocal.begin() as db:
        customer_id = str(payload.customer_id)
        quote_id = str(payload.quote_id) if payload.quote_id else None

        resell_items = list(payload.resell_items or [])
        if not payload.items and not resell_items:
            raise DomainError("At least one order line is required")

        _ensure_customer_exists(db, customer_id)

        # Create job sheets first (so we can store first version id into legacy field).
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
            # Backward compatibility summary: first line's referenced version
            product_version_id=str(created_job_sheets[0].product_version_id) if created_job_sheets else None,
            quote_id=quote_id,
            status=OrderStatus.DRAFT,
            order_date=order_date,
        )
        db.add(order)
        db.flush()

        for js in created_job_sheets:
            oi = OrderItemModel(order_id=str(order.id), job_sheet_id=str(js.id))
            db.add(oi)

        db.flush()
        for rit in resell_items:
            _add_resell_line_core(db, str(order.id), rit)

        db.flush()
        for js in created_job_sheets:
            ensure_scheduling_job_for_job_sheet(db, str(js.id))
        db.refresh(order)
        return order


def get_detail(order_id: str) -> Optional[OrderModel]:
    with SessionLocal() as db:
        # validate UUID format, but query with string key
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.jobs))
            .options(joinedload(OrderModel.items))
            .options(joinedload(OrderModel.resell_lines))
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
    """Update order header (invoice number / order date). Draft only."""
    updates = payload.model_dump(exclude_unset=True)
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")
        if "invoice_number" in updates:
            code = str(payload.invoice_number or "").strip()
            o.code = code[:32] if code else o.code
        if "order_date" in updates:
            o.order_date = payload.order_date
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
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")

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

        oi = OrderItemModel(order_id=str(o.id), job_sheet_id=str(js.id))
        db.add(oi)

        # Keep legacy summary pointer populated (first item only).
        if not getattr(o, "product_version_id", None) and getattr(js, "product_version_id", None):
            o.product_version_id = str(js.product_version_id)
            db.add(o)

        db.flush()
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
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")

        oi = db.get(OrderItemModel, str(order_item_id))
        if not oi or str(oi.order_id) != str(o.id):
            raise DomainError("Order item not found")

        db.delete(oi)
        db.flush()

        # Recompute legacy summary pointer (best-effort).
        rows = (
            db.query(OrderItemModel, JobSheet)
            .join(JobSheet, JobSheet.id == OrderItemModel.job_sheet_id)
            .filter(OrderItemModel.order_id == str(o.id))
            .order_by(JobSheet.job_seq.asc(), JobSheet.id.asc())
            .all()
        )
        if rows:
            _, js0 = rows[0]
            o.product_version_id = str(getattr(js0, "product_version_id", None)) if js0 else None
        else:
            o.product_version_id = None
        db.add(o)
        db.flush()


def add_order_resell_line(order_id: str, item: CreateResellOrderLineRequest, *, created_by: str) -> OrderResellLine:
    _ = created_by
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")
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
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")
        ln = db.get(OrderResellLine, str(line_id))
        if not ln or str(ln.order_id) != str(o.id):
            raise DomainError("Order line not found")
        db.delete(ln)
        db.flush()


def update_order_resell_line(order_id: str, line_id: str, payload: UpdateResellOrderLineRequest) -> OrderResellLine:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(order_id))
            uuid.UUID(str(line_id))
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        o = db.get(OrderModel, str(order_id))
        if not o:
            raise DomainError("Order not found")
        if o.status != OrderStatus.DRAFT:
            raise DomainError("Only draft orders can be edited")
        ln = db.get(OrderResellLine, str(line_id))
        if not ln or str(ln.order_id) != str(o.id):
            raise DomainError("Order line not found")
        data = payload.model_dump(exclude_unset=True)
        if "quantity_value" in data and data["quantity_value"] is not None:
            ln.quantity_value = float(data["quantity_value"])
        if "quantity_unit" in data and data["quantity_unit"] is not None:
            ln.quantity_unit = str(data["quantity_unit"])
        if "due_date" in data:
            ln.due_date = data["due_date"]
        if "rate" in data:
            ln.unit_rate = float(data["rate"]) if data["rate"] is not None else None
        if "total_price" in data and data["total_price"] is not None:
            ln.line_total = float(data["total_price"])
        elif "total_price" in data and data.get("total_price") is None:
            ln.line_total = None
        if "total_price" not in data:
            ur = ln.unit_rate
            if ur is not None:
                ln.line_total = float(ln.quantity_value) * float(ur)
        db.add(ln)
        db.flush()
        db.refresh(ln)
        return ln

