from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Optional, List

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload
from sqlalchemy.exc import IntegrityError

from app.db.session import SessionLocal
from app.db.models.domain import Customer, Product, ProductVersion, JobSheet
from app.exceptions import DomainError
from app.products.service import _next_version_number  # reuse version numbering helper
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


def _require_customer_code(customer: Customer) -> str:
    code = (getattr(customer, "code", None) or "").strip().upper()
    if not code:
        raise DomainError("Customer code is required to generate a job number")
    return code


def _next_job_seq(db, customer_id: str) -> int:
    current = db.scalar(select(func.max(JobSheet.job_seq)).where(JobSheet.customer_id == customer_id)) or 0
    return int(current) + 1


def suggest_next_job_no(customer_id: str) -> str:
    """
    Suggest the next job number for a customer.

    Format: {CUSTOMER_CODE}_{seq}, where seq is 1 + max existing seq for that customer.
    """
    with SessionLocal() as db:
        cid = _ensure_customer_exists(db, customer_id)
        cust = db.get(Customer, cid)
        assert cust is not None
        code = _require_customer_code(cust)
        seq = _next_job_seq(db, cid)
        return f"{code}_{seq}"


def create_job_sheet_with_new_version(payload: JobSheetCreateRequest, created_by: str) -> str:
    with SessionLocal.begin() as db:
        cid = _ensure_customer_exists(db, payload.customer_id)
        pid = _ensure_product_exists(db, payload.product_id)

        cust = db.get(Customer, cid)
        assert cust is not None
        code = _require_customer_code(cust)

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

        due_dt: Optional[datetime] = None
        if payload.due_date is not None:
            due_dt = datetime.combine(payload.due_date, time.min)

        # Allocate a per-customer sequence; retry on unique conflict (rare, but possible).
        js: Optional[JobSheet] = None
        last_err: Optional[Exception] = None
        for _ in range(5):
            seq = _next_job_seq(db, cid)
            job_no = f"{code}_{seq}"
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
) -> JobSheet:
    """
    Create a job sheet that references the product's *current active version*.
    Intended for inline Order creation.
    """
    cid = _ensure_customer_exists(db, customer_id)
    pid = _ensure_product_exists(db, product_id)

    cust = db.get(Customer, cid)
    assert cust is not None
    code = _require_customer_code(cust)

    product = db.get(Product, pid)
    assert product is not None
    if product.customer_id != cid:
        raise DomainError("Product does not belong to selected customer")
    if not product.active_version_id:
        raise DomainError("Product has no active version")

    js: Optional[JobSheet] = None
    last_err: Optional[Exception] = None
    for _ in range(5):
        seq = _next_job_seq(db, cid)
        job_no = f"{code}_{seq}"
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


def list_job_sheets(customer_id: Optional[str] = None) -> List[JobSheet]:
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
        return list(db.scalars(stmt).all())


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
        return db.scalar(stmt)


def update_job_sheet(job_sheet_id: str, payload: JobSheetUpdateRequest, *, updated_by: str) -> str:
    with SessionLocal.begin() as db:
        try:
            jid = str(uuid.UUID(job_sheet_id))
        except Exception as e:
            raise DomainError("Invalid job_sheet_id") from e

        js = db.get(JobSheet, jid)
        if not js:
            raise DomainError("Job sheet not found")

        # Update scalar fields
        js.quantity_value = float(payload.quantity_value)
        js.quantity_unit = str(payload.quantity_unit)
        js.due_date = datetime.combine(payload.due_date, time.min) if payload.due_date is not None else None

        # Optionally create a new product version + repoint job sheet
        if payload.spec is not None:
            pid = str(js.product_id)
            vnum = _next_version_number(db, pid)
            version = ProductVersion(
                product_id=pid,
                version_number=vnum,
                created_by=updated_by or "system",
                spec_payload=payload.spec.dict(),
            )
            db.add(version)
            db.flush()

            product = db.get(Product, pid)
            if product:
                product.active_version_id = version.id
                db.add(product)

            js.product_version_id = str(version.id)

        db.add(js)
        db.flush()
        return str(js.id)

