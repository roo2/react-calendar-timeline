from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.auth.deps import allow_roles_any, csrf_protect
from app.customers import service
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _customer_summary(c) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "currency_preference": c.currency_preference,
    }


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_customers(q: Optional[str] = Query(default=None)):
    customers = service.list_customers(query=q)
    return {"items": [_customer_summary(c) for c in customers]}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_customer(payload: CustomerCreateRequest):
    c = service.create_customer(payload)
    return {"ok": True, "customer": _customer_summary(c)}


@router.get("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def get_customer(customer_id: str):
    c = service.get_customer(customer_id)
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    products_count = service.get_customer_products_count(customer_id)
    orders_count = service.get_customer_orders_count(customer_id)
    return {
        "customer": _customer_summary(c)
        | {
            "abn": c.abn,
            "tax_id": c.tax_id,
            "contacts": c.contacts.get("items", []) if isinstance(c.contacts, dict) else [],
            "delivery_addresses": c.delivery_addresses.get("items", []) if isinstance(c.delivery_addresses, dict) else [],
            "delivery_preferences": c.delivery_preferences if isinstance(c.delivery_preferences, dict) else {},
            "payment_terms": c.payment_terms,
            "credit_limit": float(c.credit_limit) if c.credit_limit is not None else None,
            "notes": c.notes,
            "internal_notes": c.internal_notes,
            "products_count": products_count,
            "orders_count": orders_count,
        }
    }


@router.put("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_customer(customer_id: str, payload: CustomerUpdateRequest):
    try:
        c = service.update_customer(customer_id, payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return {"ok": True, "customer": _customer_summary(c)}
