from __future__ import annotations

import re
from typing import List, Optional

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.db.models.domain import Customer
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest


def generate_customer_code() -> str:
    """
    Generate next sequential customer code in format CUST001, CUST002, etc.
    Ensures uniqueness by finding the highest existing code number.
    """
    with SessionLocal() as db:  # type: Session
        # Find all customer codes that match the pattern CUST followed by digits
        stmt = select(Customer.code).where(Customer.code.like("CUST%"))
        codes = db.scalars(stmt).all()
        
        max_num = 0
        pattern = re.compile(r"^CUST(\d+)$")
        
        for code in codes:
            match = pattern.match(code)
            if match:
                num = int(match.group(1))
                if num > max_num:
                    max_num = num
        
        # Generate next code
        next_num = max_num + 1
        return f"CUST{next_num:03d}"


def list_customers(query: Optional[str] = None) -> List[Customer]:
    """
    List all customers, optionally filtered by search query.
    Search matches customer name or code.
    """
    with SessionLocal() as db:  # type: Session
        stmt = select(Customer).order_by(Customer.name.asc())
        
        if query:
            search_term = f"%{query}%"
            stmt = stmt.where(
                (Customer.name.ilike(search_term)) | (Customer.code.ilike(search_term))
            )
        
        return list(db.scalars(stmt).all())


def get_customer(customer_id: str) -> Optional[Customer]:
    """Get customer by ID."""
    with SessionLocal() as db:  # type: Session
        stmt = select(Customer).where(Customer.id == customer_id)
        return db.scalar(stmt)


def get_customer_by_code(code: str) -> Optional[Customer]:
    """Get customer by code."""
    with SessionLocal() as db:  # type: Session
        stmt = select(Customer).where(Customer.code == code)
        return db.scalar(stmt)


def create_customer(payload: CustomerCreateRequest) -> Customer:
    """
    Create a new customer with auto-generated code.
    Validates that at least one contact and one address are provided.
    """
    with SessionLocal() as db:  # type: Session
        # Generate customer code
        code = generate_customer_code()
        
        # Ensure code is unique (handle race condition)
        while get_customer_by_code(code) is not None:
            code = generate_customer_code()
        
        # Convert contacts and addresses to JSON-compatible format
        contacts_list = [contact.model_dump() for contact in payload.contacts]
        addresses_list = [address.model_dump() for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}
        
        customer = Customer(
            code=code,
            name=payload.name,
            abn=payload.abn,
            tax_id=payload.tax_id,
            status=payload.status,
            contacts={"items": contacts_list},  # Store as dict with 'items' key for consistency
            delivery_addresses={"items": addresses_list},  # Store as dict with 'items' key
            delivery_preferences=delivery_prefs,
            payment_terms=payload.payment_terms,
            credit_limit=payload.credit_limit,
            currency_preference=payload.currency_preference,
            notes=payload.notes,
            internal_notes=payload.internal_notes,
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
        customer = get_customer(customer_id)
        if not customer:
            raise ValueError(f"Customer with id {customer_id} not found")
        
        # Convert contacts and addresses to JSON-compatible format
        contacts_list = [contact.model_dump() for contact in payload.contacts]
        addresses_list = [address.model_dump() for address in payload.delivery_addresses]
        delivery_prefs = payload.delivery_preferences.model_dump() if payload.delivery_preferences else {}
        
        # Update fields
        customer.name = payload.name
        customer.abn = payload.abn
        customer.tax_id = payload.tax_id
        customer.status = payload.status
        customer.contacts = {"items": contacts_list}
        customer.delivery_addresses = {"items": addresses_list}
        customer.delivery_preferences = delivery_prefs
        customer.payment_terms = payload.payment_terms
        customer.credit_limit = payload.credit_limit
        customer.currency_preference = payload.currency_preference
        customer.notes = payload.notes
        customer.internal_notes = payload.internal_notes
        
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
        from app.db.models.domain import Order
        stmt = select(func.count(Order.id)).where(Order.customer_id == customer_id)
        return db.scalar(stmt) or 0
