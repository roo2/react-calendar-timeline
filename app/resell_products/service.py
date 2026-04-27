from __future__ import annotations

import uuid
from typing import List

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import SessionLocal
from app.db.models.domain import ResellProduct
from app.exceptions import DomainError
from app.resell_products.schemas import ResellProductCreate, ResellProductUpdate
from app.str_norm import strip_trailing_dash_suffix


def _normalize_default_quantity_unit(value: str | None) -> str:
    s = str(value or "ea").strip().lower()
    if s in ("each", "eaches"):
        return "ea"
    if s in ("metre", "metres", "meter"):
        return "meters"
    return s or "ea"


def list_all(*, include_inactive: bool = False) -> List[ResellProduct]:
    with SessionLocal() as db:
        stmt = (
            select(ResellProduct)
            .options(selectinload(ResellProduct.income_account))
            .order_by(ResellProduct.description.asc())
        )
        if not include_inactive:
            stmt = stmt.where(ResellProduct.active.is_(True))
        rows = list(db.scalars(stmt).all())
        # Materialize many-to-one while the session is open so `inspect().attrs.income_account.loaded_value`
        # works after the session closes (selectinload alone may not populate `state.dict` until read).
        for r in rows:
            _ = r.income_account
        return rows


def list_active() -> List[ResellProduct]:
    return list_all(include_inactive=False)


def create_row(payload: ResellProductCreate) -> ResellProduct:
    with SessionLocal.begin() as db:
        row = ResellProduct(
            id=str(uuid.uuid4()),
            description=str(payload.description).strip(),
            unit_price=float(payload.unit_price),
            default_quantity_unit=_normalize_default_quantity_unit(payload.default_quantity_unit),
            active=bool(payload.active),
        )
        db.add(row)
        db.flush()
        db.refresh(row)
        _ = row.income_account
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
            row.description = strip_trailing_dash_suffix(str(data["description"])).strip()
        if "unit_price" in data and data["unit_price"] is not None:
            row.unit_price = float(data["unit_price"])
        if "default_quantity_unit" in data:
            row.default_quantity_unit = _normalize_default_quantity_unit(data.get("default_quantity_unit"))
        if "active" in data and data["active"] is not None:
            row.active = bool(data["active"])
        db.add(row)
        db.flush()
        rid = str(row.id)
        row2 = db.scalar(
            select(ResellProduct)
            .options(selectinload(ResellProduct.income_account))
            .where(ResellProduct.id == rid)
        )
        assert row2 is not None
        _ = row2.income_account
        return row2


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
