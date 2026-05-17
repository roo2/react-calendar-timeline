from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import uuid

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.db.models.domain import Brand, Customer, CustomerPricingTier, Order, SavedQuote
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest


def _normalize_pricing_tier_id(db: Session, raw: str | None) -> str | None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    try:
        tid = str(uuid.UUID(str(raw).strip()))
    except Exception:
        raise ValueError("Invalid pricing_tier_id")
    if not db.get(CustomerPricingTier, tid):
        raise ValueError("Invalid pricing_tier_id")
    return tid


def _payment_terms_to_store(payload: CustomerCreateRequest) -> dict | None:
    if payload.payment_terms is None:
        return None
    return payload.payment_terms.model_dump(exclude_none=True)


def list_customers(
    query: Optional[str] = None,
    *,
    page: int = 1,
    page_size: int = 25,
) -> tuple[List[Customer], int]:
    """
    List customers with optional name search, ordered by priority then name.
    Returns (rows_for_page, total_matching_filters).
    """
    page = max(1, page)
    page_size = min(max(1, page_size), 500)

    with SessionLocal() as db:  # type: Session
        filters = []
        if query:
            search_term = f"%{query}%"
            filters.append(Customer.name.ilike(search_term))

        count_stmt = select(func.count()).select_from(Customer)
        for f in filters:
            count_stmt = count_stmt.where(f)
        total = int(db.scalar(count_stmt) or 0)

        stmt = (
            select(Customer)
            .options(joinedload(Customer.brand))
            .order_by(Customer.priority_rank.asc().nulls_last(), Customer.name.asc())
        )
        for f in filters:
            stmt = stmt.where(f)
        stmt = stmt.offset((page - 1) * page_size).limit(page_size)

        return list(db.scalars(stmt).all()), total


def list_brands() -> List[Brand]:
    """List available customer brands."""
    with SessionLocal() as db:  # type: Session
        stmt = select(Brand).order_by(Brand.name.asc())
        return list(db.scalars(stmt).all())


def get_customer(customer_id: str) -> Optional[Customer]:
    """Get customer by ID."""
    with SessionLocal() as db:  # type: Session
        stmt = (
            select(Customer)
            .options(joinedload(Customer.brand), joinedload(Customer.pricing_tier))
            .where(Customer.id == customer_id)
        )
        return db.scalar(stmt)


def create_customer(payload: CustomerCreateRequest) -> Customer:
    """Create a new customer."""
    with SessionLocal() as db:  # type: Session
        contacts_list = [contact.model_dump(exclude_none=True) for contact in payload.contacts]
        addresses_list = [address.model_dump(exclude_none=True) for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}
        
        tier_id = _normalize_pricing_tier_id(db, getattr(payload, "pricing_tier_id", None))

        customer = Customer(
            name=payload.name,
            pricing_tier_id=tier_id,
            brand_id=payload.brand_id,
            priority_rank=payload.priority_rank,
            abn=payload.abn,
            contact_phone=payload.contact_phone,
            status=payload.status,
            contacts={"items": contacts_list},  # Store as dict with 'items' key for consistency
            delivery_addresses={"items": addresses_list},  # Store as dict with 'items' key
            delivery_preferences=delivery_prefs,
            payment_terms=_payment_terms_to_store(payload),
            notes=payload.notes,
            xero_contact_id=payload.xero_contact_id,
        )

        db.add(customer)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError("That Xero contact is already linked to another customer.") from None
        # Re-load with brand so the instance is safe to use after the session closes (routes call _customer_summary).
        out = db.scalars(
            select(Customer)
            .options(joinedload(Customer.brand), joinedload(Customer.pricing_tier))
            .where(Customer.id == customer.id)
        ).unique().one()
        return out


def update_customer(customer_id: str, payload: CustomerUpdateRequest) -> Customer:
    """Update an existing customer."""
    with SessionLocal() as db:  # type: Session
        # IMPORTANT: load within the same SessionLocal; using get_customer() would
        # create a different session and return a detached instance.
        customer = db.scalar(
            select(Customer).options(joinedload(Customer.brand)).where(Customer.id == customer_id)
        )
        if not customer:
            raise ValueError(f"Customer with id {customer_id} not found")

        contacts_list = [contact.model_dump(exclude_none=True) for contact in payload.contacts]
        addresses_list = [address.model_dump(exclude_none=True) for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}

        customer.pricing_tier_id = _normalize_pricing_tier_id(db, getattr(payload, "pricing_tier_id", None))

        # Update fields
        customer.name = payload.name
        customer.brand_id = payload.brand_id
        customer.priority_rank = payload.priority_rank
        customer.abn = payload.abn
        customer.contact_phone = payload.contact_phone
        customer.status = payload.status
        customer.contacts = {"items": contacts_list}
        customer.delivery_addresses = {"items": addresses_list}
        customer.delivery_preferences = delivery_prefs
        customer.payment_terms = _payment_terms_to_store(payload)
        customer.notes = payload.notes
        customer.xero_contact_id = payload.xero_contact_id

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise ValueError("That Xero contact is already linked to another customer.") from None
        out = db.scalars(
            select(Customer)
            .options(joinedload(Customer.brand), joinedload(Customer.pricing_tier))
            .where(Customer.id == customer_id)
        ).unique().one()
        return out


def get_customer_products_count(customer_id: str) -> int:
    """Get count of products for a customer."""
    with SessionLocal() as db:  # type: Session
        from app.db.models.domain import Product
        stmt = select(func.count(Product.id)).where(Product.customer_id == customer_id)
        return db.scalar(stmt) or 0


def get_customer_orders_count(customer_id: str) -> int:
    """Get count of orders for a customer."""
    with SessionLocal() as db:  # type: Session
        stmt = select(func.count(Order.id)).where(Order.customer_id == customer_id)
        return db.scalar(stmt) or 0


def get_customer_quotes_count(customer_id: str) -> int:
    """Get count of saved quotes for a customer."""
    with SessionLocal() as db:  # type: Session
        stmt = select(func.count(SavedQuote.id)).where(SavedQuote.customer_id == customer_id)
        return db.scalar(stmt) or 0


def get_orders_and_quotes_counts_by_customer_ids(customer_ids: List[str]) -> Tuple[Dict[str, int], Dict[str, int]]:
    """
    Batch counts for list views. Missing customer ids are omitted (treat as 0).
    Returns (orders_count_by_customer_id, quotes_count_by_customer_id).
    """
    if not customer_ids:
        return {}, {}
    with SessionLocal() as db:  # type: Session
        o_rows = db.execute(
            select(Order.customer_id, func.count(Order.id))
            .where(Order.customer_id.in_(customer_ids))
            .group_by(Order.customer_id)
        ).all()
        q_rows = db.execute(
            select(SavedQuote.customer_id, func.count(SavedQuote.id))
            .where(SavedQuote.customer_id.in_(customer_ids))
            .group_by(SavedQuote.customer_id)
        ).all()
        orders_map = {str(r[0]): int(r[1]) for r in o_rows}
        quotes_map = {str(r[0]): int(r[1]) for r in q_rows}
        return orders_map, quotes_map
