from __future__ import annotations

from typing import List

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import Customer


def list_customers() -> List[Customer]:
    with SessionLocal() as db:  # type: Session
        stmt = select(Customer).order_by(Customer.name.asc())
        return list(db.scalars(stmt).all())


