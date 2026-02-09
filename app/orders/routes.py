from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.orders.schemas import (
    CreateOrderRequest,
    CreateJobRequest,
    OrderListItemDTO,
    OrderDetailDTO,
    JobDTO,
)
from app.orders import service
from app.exceptions import DomainError
from app.db.session import SessionLocal
from app.db.models.domain import ProductVersion, Product, Customer, OrderItem

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
        status=str(o.status),
        customer_id=o.customer_id,
        product_version_id=o.product_version_id,
        currency=o.currency,
        customer_name=(o.customer.name if getattr(o, "customer", None) else None),
        item_count=len(getattr(o, "items", []) or []),
        created_at=str(getattr(o, "created_at", None)) if getattr(o, "created_at", None) else None,
    )


def _order_to_detail_dto(o) -> OrderDetailDTO:
    return OrderDetailDTO(**_order_to_list_dto(o).model_dump(), jobs=[_job_to_dto(j) for j in (o.jobs or [])])


@router.get("", response_model=list[OrderListItemDTO], dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_orders():
    orders = service.list_orders()
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
            for pv, p in rows:
                meta[str(pv.id)] = {"product_code": p.code, "version_number": pv.version_number}
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
async def create_order(payload: CreateOrderRequest):
    try:
        o = service.create_order(payload)
        return {"ok": True, "order_id": o.id}
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
    return {
        "customers": [{"id": c.id, "name": c.name} for c in customers],
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
    with SessionLocal() as db:
        if getattr(o, "product_version_id", None):
            pv = db.get(ProductVersion, str(o.product_version_id))
            if pv:
                p = db.get(Product, str(pv.product_id))
                dto.product_code = p.code if p else None
                dto.version_number = pv.version_number

        # attach items
        item_rows = (
            db.query(OrderItem, ProductVersion, Product)
            .join(ProductVersion, ProductVersion.id == OrderItem.product_version_id)
            .join(Product, Product.id == ProductVersion.product_id)
            .filter(OrderItem.order_id == str(o.id))
            .order_by(Product.code.asc())
            .all()
        )
        dto.items = [
            {
                "id": str(oi.id),
                "product_id": str(p.id),
                "product_code": p.code,
                "product_name": getattr(p, "description", None),
                "product_version_id": str(pv.id),
                "version_number": pv.version_number,
                "quantity": float(oi.quantity),
            }
            for (oi, pv, p) in item_rows
        ]
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

