from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import inspect as sa_inspect

from app.auth.deps import allow_roles_any, csrf_protect
from app.customers import service
from app.customers.payment_terms_display import describe_payment_terms
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest
from app.integrations.xero.customer_save_sync import sync_customer_to_xero_after_save

router = APIRouter(prefix="/api/customers", tags=["customers"])


def _pricing_tier_brief_for_customer(c) -> dict | None:
    st = sa_inspect(c)
    if "pricing_tier" in st.unloaded:
        return None
    t = getattr(c, "pricing_tier", None)
    if t is None:
        return None
    dp = getattr(t, "discount_percent", 0)
    try:
        dpf = float(dp)
    except Exception:
        dpf = 0.0
    return {"id": str(t.id), "name": str(t.name), "discount_percent": dpf}


def _customer_summary(c, *, orders_count: int | None = None, quotes_count: int | None = None) -> dict:
    b = getattr(c, "brand", None)
    d = {
        "id": c.id,
        "name": c.name,
        "status": c.status,
        "pricing_tier_id": getattr(c, "pricing_tier_id", None),
        "brand_id": getattr(c, "brand_id", None),
        "brand_code": b.code if b else None,
        "brand_name": b.name if b else None,
        "contact_first_name": getattr(c, "contact_first_name", None),
        "priority_rank": getattr(c, "priority_rank", None),
    }
    brief = _pricing_tier_brief_for_customer(c)
    if brief is not None:
        d["pricing_tier"] = brief
    if orders_count is not None:
        d["orders_count"] = orders_count
    if quotes_count is not None:
        d["quotes_count"] = quotes_count
    return d


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_customers(
    q: Optional[str] = Query(default=None, description="Legacy search alias for search"),
    search: Optional[str] = Query(default=None),
    brand_code: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    contact: Optional[str] = Query(default=None),
    email: Optional[str] = Query(default=None),
    phone: Optional[str] = Query(default=None),
    abn: Optional[str] = Query(default=None),
    myob_display_id: Optional[str] = Query(default=None),
    sort_by: Optional[str] = Query(
        default=None,
        description="Sort field: name, brand, contact, status, quotes, orders",
    ),
    sort_dir: Optional[str] = Query(default=None, description="asc or desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=500),
):
    effective_search = (search or q or "").strip() or None
    customers, total = service.list_customers(
        query=effective_search,
        brand_code=brand_code,
        status=status,
        contact=contact,
        email=email,
        phone=phone,
        abn=abn,
        myob_display_id=myob_display_id,
        sort_by=sort_by,
        sort_dir=sort_dir,
        page=page,
        page_size=page_size,
    )
    ids = [str(c.id) for c in customers]
    orders_by_c, quotes_by_c = service.get_orders_and_quotes_counts_by_customer_ids(ids)
    return {
        "items": [
            _customer_summary(
                c,
                orders_count=orders_by_c.get(str(c.id), 0),
                quotes_count=quotes_by_c.get(str(c.id), 0),
            )
            for c in customers
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/brands", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def list_customer_brands():
    brands = service.list_brands()
    return {"items": [{"id": b.id, "code": b.code, "name": b.name} for b in brands]}


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_customer(payload: CustomerCreateRequest):
    try:
        c = service.create_customer(payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    xero_sync = sync_customer_to_xero_after_save(customer_id=str(c.id))
    return {"ok": True, "customer": _customer_summary(c), "xero_sync": xero_sync}


@router.get("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))])
async def get_customer(customer_id: str):
    c = service.get_customer(customer_id)
    if not c:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    products_count = service.get_customer_products_count(customer_id)
    orders_count = service.get_customer_orders_count(customer_id)
    quotes_count = service.get_customer_quotes_count(customer_id)
    can_delete = service.customer_can_delete(customer_id)
    return {
        "customer": _customer_summary(c)
        | {
            "abn": c.abn,
            "contact_first_name": getattr(c, "contact_first_name", None),
            "contact_last_name": getattr(c, "contact_last_name", None),
            "email_address": getattr(c, "email_address", None),
            "contact_phone": getattr(c, "contact_phone", None),
            "phones": (
                c.phones.get("items", [])
                if isinstance(getattr(c, "phones", None), dict)
                else []
            ),
            "contacts": c.contacts.get("items", []) if isinstance(c.contacts, dict) else [],
            "delivery_addresses": c.delivery_addresses.get("items", []) if isinstance(c.delivery_addresses, dict) else [],
            "delivery_preferences": c.delivery_preferences if isinstance(c.delivery_preferences, dict) else {},
            "payment_terms": c.payment_terms,
            "payment_terms_summary": describe_payment_terms(c.payment_terms)
            if isinstance(getattr(c, "payment_terms", None), dict)
            else None,
            "notes": c.notes,
            "myob_customer_uid": getattr(c, "myob_customer_uid", None),
            "myob_display_id": getattr(c, "myob_display_id", None),
            "myob_last_modified": c.myob_last_modified.isoformat() if getattr(c, "myob_last_modified", None) else None,
            "myob_synced_at": c.myob_synced_at.isoformat() if getattr(c, "myob_synced_at", None) else None,
            "myob_notes": getattr(c, "myob_notes", None),
            "xero_contact_id": getattr(c, "xero_contact_id", None),
            "xero_last_modified": c.xero_last_modified.isoformat() if getattr(c, "xero_last_modified", None) else None,
            "xero_synced_at": c.xero_synced_at.isoformat() if getattr(c, "xero_synced_at", None) else None,
            "products_count": products_count,
            "orders_count": orders_count,
            "quotes_count": quotes_count,
            "can_delete": can_delete,
        }
    }


@router.delete(
    "/{customer_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def delete_customer(customer_id: str):
    try:
        service.delete_customer(customer_id)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=msg) from e
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg) from e
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_customer(customer_id: str, payload: CustomerUpdateRequest):
    try:
        existing = service.get_customer(customer_id)
        if not existing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
        c = service.update_customer(customer_id, payload)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg.lower():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=msg) from e
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=msg) from e
    xero_sync = sync_customer_to_xero_after_save(customer_id=str(c.id))
    return {"ok": True, "customer": _customer_summary(c), "xero_sync": xero_sync}
