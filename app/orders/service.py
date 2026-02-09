from __future__ import annotations

import uuid
from typing import List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.db.session import SessionLocal
from app.db.models.domain import (
    Order as OrderModel,
    OrderItem as OrderItemModel,
    Job as JobModel,
    Customer,
    ProductVersion,
)
from app.db.models.enums import OrderStatus, JobStatus
from app.exceptions import DomainError
from app.orders.schemas import CreateOrderRequest, CreateJobRequest


def _new_order_code() -> str:
    # Keep human-readable, unique, and short (orders.code is VARCHAR(32)).
    return f"ORD-{uuid.uuid4().hex[:8].upper()}"


def _ensure_customer_and_version(db, customer_id: str, product_version_id: str) -> None:
    # Validate UUID formats early (but keep DB keys as strings)
    try:
        uuid.UUID(str(customer_id))
        uuid.UUID(str(product_version_id))
    except Exception as e:
        raise DomainError("Invalid identifiers") from e

    # Validate customer exists
    if not db.get(Customer, str(customer_id)):
        raise DomainError("Customer not found")
    # Validate version exists
    pv = db.get(ProductVersion, str(product_version_id))
    if not pv:
        raise DomainError("Product version not found")
    # Optional: ensure version belongs to the same customer's product
    if pv.product.customer_id != str(customer_id):
        raise DomainError("Product version does not belong to the specified customer")


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


def create_order(payload: CreateOrderRequest) -> OrderModel:
    with SessionLocal() as db:
        # Validate identifiers, but keep DB keys as strings (SQLite can't bind UUID objects)
        customer_id = str(payload.customer_id)
        quote_id = str(payload.quote_id) if payload.quote_id else None

        # Normalize items: prefer items[], fall back to legacy product_version_id
        item_pvs: list[tuple[str, object]] = []
        if payload.items:
            for it in payload.items:
                pv_id = str(it.product_version_id)
                item_pvs.append((pv_id, it))
        elif payload.product_version_id:
            pv_id = str(payload.product_version_id)
            # quantity default = 1
            class _Tmp:
                quantity = 1

            item_pvs.append((pv_id, _Tmp()))
        else:
            raise DomainError("At least one product is required")

        for pv_id, _it in item_pvs:
            _ensure_customer_and_version(db, customer_id, pv_id)

        try:
            status = OrderStatus(payload.status)
        except Exception:
            status = OrderStatus.DRAFT
        order = OrderModel(
            code=_new_order_code(),
            customer_id=customer_id,
            # For backward compatibility, store the first item in the legacy field
            product_version_id=str(item_pvs[0][0]) if item_pvs else None,
            quote_id=quote_id,
            status=status,
            currency=payload.currency,
        )
        db.add(order)
        db.flush()

        for pv_id, it in item_pvs:
            oi = OrderItemModel(
                order_id=str(order.id),
                product_version_id=str(pv_id),
                quantity=getattr(it, "quantity", 1),
            )
            db.add(oi)

        db.commit()
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

