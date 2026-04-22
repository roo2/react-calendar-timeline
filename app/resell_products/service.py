from __future__ import annotations

import uuid
from typing import List

from sqlalchemy import select

from app.db.session import SessionLocal
from app.db.models.domain import ResellProduct
from app.exceptions import DomainError
from app.resell_products.schemas import ResellProductCreate, ResellProductUpdate


def list_all(*, include_inactive: bool = False) -> List[ResellProduct]:
    with SessionLocal() as db:
        stmt = select(ResellProduct).order_by(ResellProduct.description.asc())
        if not include_inactive:
            stmt = stmt.where(ResellProduct.active.is_(True))
        return list(db.execute(stmt).scalars().all())


def list_active() -> List[ResellProduct]:
    return list_all(include_inactive=False)


def create_row(payload: ResellProductCreate) -> ResellProduct:
    with SessionLocal.begin() as db:
        row = ResellProduct(
            id=str(uuid.uuid4()),
            description=str(payload.description).strip(),
            unit_price=float(payload.unit_price),
            active=bool(payload.active),
        )
        db.add(row)
        db.flush()
        db.refresh(row)
        return row


def update_row(resell_product_id: str, payload: ResellProductUpdate) -> ResellProduct:
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(resell_product_id))
        except Exception as e:
            raise DomainError("Invalid resell product id") from e
        row = db.get(ResellProduct, str(resell_product_id))
        if not row:
            raise DomainError("Resell product not found")
        data = payload.model_dump(exclude_unset=True)
        if "description" in data and data["description"] is not None:
            row.description = str(data["description"]).strip()
        if "unit_price" in data and data["unit_price"] is not None:
            row.unit_price = float(data["unit_price"])
        if "active" in data and data["active"] is not None:
            row.active = bool(data["active"])
        db.add(row)
        db.flush()
        db.refresh(row)
        return row


def delete_row(resell_product_id: str) -> None:
    """Hard delete (only if unused); prefer deactivating from admin UI."""
    with SessionLocal.begin() as db:
        try:
            uuid.UUID(str(resell_product_id))
        except Exception as e:
            raise DomainError("Invalid resell product id") from e
        row = db.get(ResellProduct, str(resell_product_id))
        if not row:
            raise DomainError("Resell product not found")
        db.delete(row)
        db.flush()
