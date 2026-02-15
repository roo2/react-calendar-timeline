from __future__ import annotations

import uuid
from datetime import datetime, time
from typing import Optional, List

from sqlalchemy import select, func
from sqlalchemy.orm import joinedload

from app.db.session import SessionLocal
from app.db.models.domain import Customer, Product, ProductVersion, JobSheet
from app.exceptions import DomainError
from app.products.service import _next_version_number  # reuse version numbering helper
from app.job_sheets.schemas import JobSheetCreateRequest


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


def suggest_next_job_no(customer_id: str) -> str:
    """
    Suggest the next job number for a customer.

    Format: {CUSTOMER_CODE}_{seq}, where seq is 1 + max existing seq for that customer.
    """
    with SessionLocal() as db:
        cid = _ensure_customer_exists(db, customer_id)
        cust = db.get(Customer, cid)
        assert cust is not None
        code = (getattr(cust, "code", None) or "").strip().upper()
        if not code:
            raise DomainError("Customer code is required to generate a job number")

        prefix = f"{code}_"
        rows = db.execute(
            select(JobSheet.job_no).where(
                JobSheet.customer_id == cid,
                JobSheet.job_no.like(f"{prefix}%"),
            )
        ).all()

        max_seq = 0
        for (job_no,) in rows:
            s = str(job_no or "")
            if not s.startswith(prefix):
                continue
            tail = s[len(prefix) :]
            try:
                n = int(tail)
            except Exception:
                continue
            if n > max_seq:
                max_seq = n

        return f"{code}_{max_seq + 1}"


def create_job_sheet_with_new_version(payload: JobSheetCreateRequest, created_by: str) -> str:
    job_no = (payload.job_no or "").strip()
    if not job_no:
        raise DomainError("job_no is required")

    with SessionLocal.begin() as db:
        cid = _ensure_customer_exists(db, payload.customer_id)
        pid = _ensure_product_exists(db, payload.product_id)

        product = db.get(Product, pid)
        assert product is not None
        if product.customer_id != cid:
            raise DomainError("Product does not belong to selected customer")

        existing = db.scalar(select(func.count()).select_from(JobSheet).where(JobSheet.job_no == job_no)) or 0
        if existing > 0:
            raise DomainError("Job number already exists")

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

        js = JobSheet(
            job_no=job_no,
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

        # IMPORTANT: capture ID before session closes/attributes expire
        return str(js.id)


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

