from __future__ import annotations

from typing import Dict, List, Optional, Tuple

from sqlalchemy import select, func
from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.db.models.domain import Customer, Order, SavedQuote
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest


def list_customers(query: Optional[str] = None) -> List[Customer]:
    """
    List all customers, optionally filtered by search query.
    Search matches customer name.
    """
    with SessionLocal() as db:  # type: Session
        stmt = (
            select(Customer)
            .options(joinedload(Customer.brand))
            .order_by(Customer.priority_rank.asc().nulls_last(), Customer.name.asc())
        )

        if query:
            search_term = f"%{query}%"
            stmt = stmt.where(Customer.name.ilike(search_term))
        
        return list(db.scalars(stmt).all())


def get_customer(customer_id: str) -> Optional[Customer]:
    """Get customer by ID."""
    with SessionLocal() as db:  # type: Session
        stmt = (
            select(Customer)
            .options(joinedload(Customer.brand))
            .where(Customer.id == customer_id)
        )
        return db.scalar(stmt)


class DuplicateCustomerCodeError(ValueError):
    """Raised when creating a customer with a code that already exists."""


def create_customer(payload: CustomerCreateRequest) -> Customer:
    """
    Create a new customer.
    Validates that at least one contact and one address are provided.
    Raises DuplicateCustomerCodeError if a customer with the same code already exists.
    """
    with SessionLocal() as db:  # type: Session
        existing = db.scalar(select(Customer).where(Customer.code == payload.code))
        if existing:
            raise DuplicateCustomerCodeError(f"A customer with code '{payload.code}' already exists.")

        # Convert contacts and addresses to JSON-compatible format
        contacts_list = [contact.model_dump() for contact in payload.contacts]
        addresses_list = [address.model_dump() for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}
        
        customer = Customer(
            code=payload.code,
            name=payload.name,
            brand_id=payload.brand_id,
            priority_rank=payload.priority_rank,
            abn=payload.abn,
            contact_phone=payload.contact_phone,
            status=payload.status,
            contacts={"items": contacts_list},  # Store as dict with 'items' key for consistency
            delivery_addresses={"items": addresses_list},  # Store as dict with 'items' key
            delivery_preferences=delivery_prefs,
            payment_terms=payload.payment_terms,
            deposit_required=payload.deposit_required,
            deposit_pct=payload.deposit_pct,
            notes=payload.notes,
        )
        
        db.add(customer)
        db.commit()
        db.refresh(customer)
        return customer


def update_customer(customer_id: str, payload: CustomerUpdateRequest) -> Customer:
    """
    Update an existing customer.
    Validates that at least one contact and one address are provided.
    """
    with SessionLocal() as db:  # type: Session
        # IMPORTANT: load within the same SessionLocal; using get_customer() would
        # create a different session and return a detached instance.
        customer = db.scalar(select(Customer).where(Customer.id == customer_id))
        if not customer:
            raise ValueError(f"Customer with id {customer_id} not found")
        
        # Convert contacts and addresses to JSON-compatible format
        contacts_list = [contact.model_dump() for contact in payload.contacts]
        addresses_list = [address.model_dump() for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}
        
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
        customer.payment_terms = payload.payment_terms
        customer.deposit_required = payload.deposit_required
        customer.deposit_pct = payload.deposit_pct
        customer.notes = payload.notes
        
        db.commit()
        db.refresh(customer)
        return customer


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
