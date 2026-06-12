from __future__ import annotations

import uuid
from typing import List, Optional

from sqlalchemy import select

from app.brands.schemas import BrandDTO, BrandUpdate, dto_from_orm
from app.db.models.domain import Brand
from app.db.session import SessionLocal
from app.exceptions import DomainError


def list_brands_ordered() -> List[Brand]:
    with SessionLocal() as db:
        stmt = select(Brand).order_by(Brand.name.asc())
        return list(db.scalars(stmt).all())


def brand_id_for_xero_branding_theme_id(db, theme_id: str | None) -> str | None:
    xid = str(theme_id or "").strip()
    if not xid:
        return None
    bid = db.scalar(select(Brand.id).where(Brand.xero_branding_theme_id == xid))
    return str(bid) if bid else None


def update_brand(brand_id: str, payload: BrandUpdate) -> BrandDTO:
    with SessionLocal() as db:
        try:
            bid = str(uuid.UUID(brand_id))
        except Exception as e:
            raise DomainError("Invalid brand id") from e
        row = db.get(Brand, bid)
        if not row:
            raise DomainError("Brand not found")
        row.xero_branding_theme_id = payload.xero_branding_theme_id
        db.add(row)
        db.commit()
        db.refresh(row)
        return dto_from_orm(row)


def get_brand(brand_id: str) -> Optional[Brand]:
    with SessionLocal() as db:
        try:
            bid = str(uuid.UUID(brand_id))
        except Exception:
            return None
        return db.get(Brand, bid)
