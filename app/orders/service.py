from __future__ import annotations

import uuid
from typing import List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.db.session import SessionLocal
from app.db.models.domain import Order as OrderModel, Job as JobModel, Customer, ProductVersion
from app.db.models.enums import OrderStatus, JobStatus
from app.exceptions import DomainError
from app.orders.schemas import CreateOrderRequest, CreateJobRequest


def _ensure_customer_and_version(db, customer_id: uuid.UUID, product_version_id: uuid.UUID) -> None:
    # Validate customer exists
    if not db.get(Customer, customer_id):
        raise DomainError("Customer not found")
    # Validate version exists
    pv = db.get(ProductVersion, product_version_id)
    if not pv:
        raise DomainError("Product version not found")
    # Optional: ensure version belongs to the same customer's product
    if pv.product.customer_id != customer_id:
        raise DomainError("Product version does not belong to the specified customer")


def _next_job_code(db, order_id: uuid.UUID) -> int:
    current = db.scalar(select(func.max(JobModel.job_code)).where(JobModel.order_id == order_id))
    return int(current or 0) + 1


def list_orders() -> List[OrderModel]:
    with SessionLocal() as db:
        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.customer))
            .order_by(OrderModel.created_at.desc())
        )
        return list(db.scalars(stmt).all())


def create_order(payload: CreateOrderRequest) -> OrderModel:
    with SessionLocal() as db:
        # Coerce to UUIDs
        try:
            customer_id = uuid.UUID(str(payload.customer_id))
            product_version_id = uuid.UUID(str(payload.product_version_id))
            quote_id = uuid.UUID(str(payload.quote_id)) if payload.quote_id else None
        except Exception as e:
            raise DomainError("Invalid identifiers") from e
        _ensure_customer_and_version(db, customer_id, product_version_id)
        try:
            status = OrderStatus(payload.status)
        except Exception:
            status = OrderStatus.DRAFT
        order = OrderModel(
            customer_id=customer_id,
            product_version_id=product_version_id,
            quote_id=quote_id,
            status=status,
            currency=payload.currency,
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        return order


def get_detail(order_id: str) -> Optional[OrderModel]:
    with SessionLocal() as db:
        oid = uuid.UUID(order_id)
        stmt = (
            select(OrderModel)
            .options(joinedload(OrderModel.jobs))
            .options(joinedload(OrderModel.customer))
            .where(OrderModel.id == oid)
        )
        return db.scalar(stmt)


def create_job(order_id: str, payload: CreateJobRequest) -> JobModel:
    with SessionLocal() as db:
        oid = uuid.UUID(order_id)
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

