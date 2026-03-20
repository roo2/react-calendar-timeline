from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.orders.schemas import (
    CreateOrderRequest,
    CreateOrderItemRequest,
    CreateJobRequest,
    UpdateOrderRequest,
    OrderListItemDTO,
    OrderDetailDTO,
    JobDTO,
)
from app.orders import service
from app.exceptions import DomainError
from app.db.session import SessionLocal
from app.db.models.domain import ProductVersion, Product, Customer, OrderItem, JobSheet
from app.products.service import compute_product_code_full

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _job_to_dto(j) -> JobDTO:
    return JobDTO(
        id=j.id,
        job_code=j.job_code,
        planned_qty=j.planned_qty,
        produced_qty=j.produced_qty,
        allocated_order_units=j.allocated_order_units,
        status=str(j.status),
    )


def _order_to_list_dto(o) -> OrderListItemDTO:
    return OrderListItemDTO(
        id=o.id,
        code=o.code,
        status=(getattr(o.status, "value", None) or str(o.status)),
        customer_id=o.customer_id,
        product_version_id=o.product_version_id,
        customer_name=(o.customer.name if getattr(o, "customer", None) else None),
        item_count=len(getattr(o, "items", []) or []),
        created_at=str(getattr(o, "created_at", None)) if getattr(o, "created_at", None) else None,
        order_date=str(getattr(o, "order_date", None)) if getattr(o, "order_date", None) else None,
    )


def _order_to_detail_dto(o) -> OrderDetailDTO:
    return OrderDetailDTO(**_order_to_list_dto(o).model_dump(), jobs=[_job_to_dto(j) for j in (o.jobs or [])])


@router.get("", response_model=list[OrderListItemDTO], dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_orders(customer_id: str | None = Query(default=None)):
    if customer_id:
        try:
            uuid.UUID(str(customer_id))
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid customer_id")
    orders = service.list_orders(customer_id=customer_id)
    # Enrich with product code/version in a single DB round trip.
    # For multi-item orders, we use the first item as the summary.
    meta: dict[str, dict] = {}
    ids = [str(o.product_version_id) for o in orders if getattr(o, "product_version_id", None)]
    if ids:
        with SessionLocal() as db:
            rows = (
                db.query(ProductVersion, Product)
                .join(Product, Product.id == ProductVersion.product_id)
                .filter(ProductVersion.id.in_(ids))
                .all()
            )
            changed = False
            for pv, p in rows:
                computed_code = ""
                if isinstance(getattr(pv, "spec_payload", None), dict):
                    computed_code = compute_product_code_full(p, pv.spec_payload)
                if computed_code and computed_code != getattr(p, "code", None):
                    p.code = computed_code
                    db.add(p)
                    changed = True
                meta[str(pv.id)] = {"product_code": p.code, "version_number": pv.version_number}
            if changed:
                db.commit()
    out: list[OrderListItemDTO] = []
    for o in orders:
        dto = _order_to_list_dto(o)
        m = meta.get(str(o.product_version_id)) if getattr(o, "product_version_id", None) else None
        if m:
            dto.product_code = m.get("product_code")
            dto.version_number = m.get("version_number")
        out.append(dto)
    return out


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_order(payload: CreateOrderRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        o = service.create_order(payload, created_by=created_by)
        return {"ok": True, "order_id": str(o.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.patch("/{order_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_order(order_id: str, payload: UpdateOrderRequest):
    try:
        uuid.UUID(str(order_id))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid order_id")
    try:
        o = service.update_order(order_id, payload)
        return {"ok": True, "order_id": str(o.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{order_id}/items", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def add_order_item(order_id: str, payload: CreateOrderItemRequest, identity=Depends(current_identity)):
    try:
        u = identity.get("user")
        created_by = (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None) or "system"
        oi = service.add_order_item(order_id, payload, created_by=created_by)
        return {"ok": True, "order_item_id": str(oi.id)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.delete("/{order_id}/items/{order_item_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def remove_order_item(order_id: str, order_item_id: str):
    try:
        service.remove_order_item(order_id, order_item_id)
        return {"ok": True}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.get("/bootstrap", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def orders_bootstrap():
    """
    Data needed to render the "New Order" form:
    - customers list
    - active product versions list with product code + version number
    """
    with SessionLocal() as db:
        customers = (
            db.query(Customer)
            .order_by(Customer.name.asc())
            .all()
        )
        versions = (
            db.query(ProductVersion, Product, Customer)
            .join(Product, ProductVersion.id == Product.active_version_id)
            .join(Customer, Product.customer_id == Customer.id, isouter=True)
            .order_by(Product.code.asc(), ProductVersion.version_number.desc())
            .all()
        )
        changed = False
        if versions:
            for pv, p, cust in versions:
                computed_code = ""
                if isinstance(getattr(pv, "spec_payload", None), dict):
                    computed_code = compute_product_code_full(p, pv.spec_payload)
                if computed_code and computed_code != getattr(p, "code", None):
                    p.code = computed_code
                    db.add(p)
                    changed = True
            if changed:
                db.commit()
    return {
        "customers": [{"id": str(c.id), "name": c.name, "code": getattr(c, "code", None)} for c in customers],
        # legacy field (kept so older clients can still render a version dropdown)
        "versions": [
            {
                "id": str(pv.id),
                "product_id": str(p.id),
                "product_code": p.code,
                "version_number": pv.version_number,
                "customer_name": (cust.name if cust else None),
            }
            for (pv, p, cust) in versions
        ],
    }


@router.get("/{order_id}", response_model=OrderDetailDTO, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def show_order(order_id: str):
    o = service.get_detail(order_id)
    if not o:
        raise HTTPException(status_code=404, detail="Order not found")
    dto = _order_to_detail_dto(o)
    # Add customer_name and product meta
    dto.customer_name = (o.customer.name if getattr(o, "customer", None) else None)
    dto.created_at = str(getattr(o, "created_at", None)) if getattr(o, "created_at", None) else None
    dto.order_date = str(getattr(o, "order_date", None)) if getattr(o, "order_date", None) else None
    with SessionLocal() as db:
        if getattr(o, "product_version_id", None):
            pv = db.get(ProductVersion, str(o.product_version_id))
            if pv:
                p = db.get(Product, str(pv.product_id))
                if p:
                    computed_code = ""
                    if isinstance(getattr(pv, "spec_payload", None), dict):
                        computed_code = compute_product_code_full(p, pv.spec_payload)
                    if computed_code and computed_code != getattr(p, "code", None):
                        p.code = computed_code
                        db.add(p)
                        try:
                            db.commit()
                        except Exception:
                            db.rollback()
                    dto.product_code = p.code
                else:
                    dto.product_code = None
                dto.version_number = pv.version_number

        # attach items
        item_rows = (
            db.query(OrderItem, JobSheet, ProductVersion, Product)
            .join(JobSheet, JobSheet.id == OrderItem.job_sheet_id)
            .join(ProductVersion, ProductVersion.id == JobSheet.product_version_id)
            .join(Product, Product.id == ProductVersion.product_id)
            .filter(OrderItem.order_id == str(o.id))
            .order_by(JobSheet.job_seq.asc(), Product.code.asc())
            .all()
        )
        dto.items = []
        changed_items = False
        for (oi, js, pv, p) in item_rows:
            computed_code = ""
            if isinstance(getattr(pv, "spec_payload", None), dict):
                computed_code = compute_product_code_full(p, pv.spec_payload)
            if computed_code and computed_code != getattr(p, "code", None):
                p.code = computed_code
                db.add(p)
                changed_items = True
            dto.items.append(
                {
                    "id": str(oi.id),
                    "job_sheet_id": str(js.id),
                    "job_no": js.job_no,
                    "product_id": str(p.id),
                    "product_code": p.code,
                    "product_name": getattr(p, "description", None),
                    "product_version_id": str(pv.id),
                    "version_number": pv.version_number,
                    "due_date": (str(js.due_date.date()) if getattr(js, "due_date", None) is not None else None),
                    "quantity_value": float(js.quantity_value),
                    "quantity_unit": js.quantity_unit,
                    "rate": float(js.unit_rate) if getattr(js, "unit_rate", None) is not None else None,
                    "total_price": float(js.line_total) if getattr(js, "line_total", None) is not None else None,
                }
            )
        if changed_items:
            db.commit()
    return dto


@router.post("/{order_id}/jobs", dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())])
async def create_job(
    order_id: str,
    payload: CreateJobRequest,
):
    try:
        j = service.create_job(order_id, payload)
        return {"ok": True, "job": _job_to_dto(j)}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)


@router.post("/{order_id}/publish", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def publish_order(order_id: str):
    try:
        o = service.publish_order(order_id)
        return {"ok": True, "order_id": str(o.id), "status": (getattr(o.status, "value", None) or str(o.status))}
    except DomainError as e:
        raise HTTPException(status_code=400, detail=e.message)

