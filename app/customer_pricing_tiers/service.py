from __future__ import annotations

import uuid
from typing import List, Optional

from sqlalchemy import func, select
from app.customer_pricing_tiers.schemas import CustomerPricingTierCreate, CustomerPricingTierDTO, CustomerPricingTierUpdate, dto_from_orm
from app.db.models.domain import Customer, CustomerPricingTier
from app.db.session import SessionLocal
from app.exceptions import DomainError


def list_tiers_ordered() -> List[CustomerPricingTier]:
    with SessionLocal() as db:
        stmt = select(CustomerPricingTier).order_by(CustomerPricingTier.sort_order.asc(), CustomerPricingTier.name.asc())
        return list(db.scalars(stmt).all())


def get_tier(tier_id: str) -> Optional[CustomerPricingTier]:
    with SessionLocal() as db:
        try:
            tid = str(uuid.UUID(tier_id))
        except Exception:
            return None
        return db.get(CustomerPricingTier, tid)


def create_tier(payload: CustomerPricingTierCreate) -> CustomerPricingTierDTO:
    with SessionLocal() as db:
        row = CustomerPricingTier(
            id=str(uuid.uuid4()),
            name=payload.name.strip(),
            discount_percent=payload.discount_percent,
            sort_order=int(payload.sort_order),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return dto_from_orm(row)


def update_tier(tier_id: str, payload: CustomerPricingTierUpdate) -> CustomerPricingTierDTO:
    with SessionLocal() as db:
        try:
            tid = str(uuid.UUID(tier_id))
        except Exception as e:
            raise DomainError("Invalid tier id") from e
        row = db.get(CustomerPricingTier, tid)
        if not row:
            raise DomainError("Pricing tier not found")
        if payload.name is not None:
            row.name = payload.name.strip()
        if payload.discount_percent is not None:
            row.discount_percent = payload.discount_percent
        if payload.sort_order is not None:
            row.sort_order = int(payload.sort_order)
        db.add(row)
        db.commit()
        db.refresh(row)
        return dto_from_orm(row)


def delete_tier(tier_id: str) -> None:
    with SessionLocal() as db:
        try:
            tid = str(uuid.UUID(tier_id))
        except Exception as e:
            raise DomainError("Invalid tier id") from e
        row = db.get(CustomerPricingTier, tid)
        if not row:
            raise DomainError("Pricing tier not found")
        n = db.scalar(select(func.count()).select_from(Customer).where(Customer.pricing_tier_id == tid)) or 0
        if int(n) > 0:
            raise DomainError("Cannot delete a pricing tier that is assigned to customers")
        db.delete(row)
        db.commit()
