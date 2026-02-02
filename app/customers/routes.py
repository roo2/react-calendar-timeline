from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request, Form, HTTPException, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from pydantic import ValidationError

from app.auth.deps import allow_roles_any, csrf_protect, current_identity
from app.customers import service
from app.customers.schemas import CustomerCreateRequest, CustomerUpdateRequest
from app.exceptions import DomainError
import json

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def list_customers(request: Request, q: Optional[str] = None, identity=Depends(current_identity)):
    """List all customers with optional search."""
    try:
        customers = service.list_customers(query=q)
        return templates.TemplateResponse(
            "customers/index.html",
            {"request": request, "customers": customers, "q": q or "", "identity": identity},
        )
    except Exception as e:
        import logging
        import traceback
        logger = logging.getLogger("customers")
        logger.error(f"Error in list_customers: {e}")
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error loading customers: {str(e)}")


@router.get("/test", response_class=HTMLResponse)
async def test_route(request: Request):
    """Test route to verify router is registered."""
    return HTMLResponse("<h1>Customers router is working!</h1>")


@router.get("/new", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def new_customer(request: Request, identity=Depends(current_identity)):
    """Display form to create a new customer."""
    return templates.TemplateResponse(
        "customers/new.html",
        {"request": request, "identity": identity, "customer": None, "errors": None},
    )


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_customer(
    request: Request,
    identity=Depends(current_identity),
):
    """Create a new customer from form data."""
    try:
        form_data = await request.form()
        
        # Parse contacts
        contacts_json = form_data.get("contacts_json", "[]")
        try:
            contacts_list = json.loads(contacts_json) if contacts_json else []
        except json.JSONDecodeError:
            contacts_list = []
        
        # Parse addresses
        addresses_json = form_data.get("addresses_json", "[]")
        try:
            addresses_list = json.loads(addresses_json) if addresses_json else []
        except json.JSONDecodeError:
            addresses_list = []
        
        # Parse delivery preferences
        delivery_prefs_json = form_data.get("delivery_preferences_json", "{}")
        try:
            delivery_prefs_dict = json.loads(delivery_prefs_json) if delivery_prefs_json else {}
        except json.JSONDecodeError:
            delivery_prefs_dict = {}
        
        # Convert to Pydantic models
        from app.customers.schemas import ContactInput, AddressInput, DeliveryPreferencesInput
        
        contacts = [ContactInput(**c) for c in contacts_list]
        addresses = [AddressInput(**a) for a in addresses_list]
        delivery_prefs = DeliveryPreferencesInput(**delivery_prefs_dict) if delivery_prefs_dict else None
        
        # Build payload
        payload = CustomerCreateRequest(
            name=form_data.get("name", ""),
            abn=form_data.get("abn") or None,
            tax_id=form_data.get("tax_id") or None,
            status=form_data.get("status", "Active"),
            contacts=contacts,
            delivery_addresses=addresses,
            delivery_preferences=delivery_prefs,
            payment_terms=form_data.get("payment_terms") or None,
            credit_limit=float(form_data.get("credit_limit")) if form_data.get("credit_limit") else None,
            currency_preference=form_data.get("currency_preference", "AUD"),
            notes=form_data.get("notes") or None,
            internal_notes=form_data.get("internal_notes") or None,
        )
        
        customer = service.create_customer(payload)
        return RedirectResponse(url=f"/customers/{customer.id}", status_code=303)
        
    except (ValidationError, ValueError, DomainError) as e:
        # Return form with errors
        error_msg = str(e)
        if isinstance(e, ValidationError):
            error_msg = "; ".join([f"{err['loc']}: {err['msg']}" for err in e.errors()])
        return templates.TemplateResponse(
            "customers/new.html",
            {
                "request": request,
                "identity": identity,
                "customer": None,
                "errors": error_msg,
                "form_data": dict(form_data),
            },
            status_code=400,
        )


@router.get("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def show_customer(request: Request, customer_id: str, identity=Depends(current_identity)):
    """Display customer details."""
    customer = service.get_customer(customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    
    # Get related counts
    products_count = service.get_customer_products_count(customer_id)
    orders_count = service.get_customer_orders_count(customer_id)
    
    # Parse JSON fields for display
    contacts = customer.contacts.get("items", []) if isinstance(customer.contacts, dict) else []
    addresses = customer.delivery_addresses.get("items", []) if isinstance(customer.delivery_addresses, dict) else []
    delivery_prefs = customer.delivery_preferences if isinstance(customer.delivery_preferences, dict) else {}
    
    return templates.TemplateResponse(
        "customers/show.html",
        {
            "request": request,
            "customer": customer,
            "contacts": contacts,
            "addresses": addresses,
            "delivery_preferences": delivery_prefs,
            "products_count": products_count,
            "orders_count": orders_count,
            "identity": identity,
        },
    )


@router.get("/{customer_id}/edit", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def edit_customer(request: Request, customer_id: str, identity=Depends(current_identity)):
    """Display form to edit customer."""
    customer = service.get_customer(customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    
    # Parse JSON fields for form
    contacts = customer.contacts.get("items", []) if isinstance(customer.contacts, dict) else []
    addresses = customer.delivery_addresses.get("items", []) if isinstance(customer.delivery_addresses, dict) else []
    delivery_prefs = customer.delivery_preferences if isinstance(customer.delivery_preferences, dict) else {}
    
    return templates.TemplateResponse(
        "customers/edit.html",
        {
            "request": request,
            "customer": customer,
            "contacts": contacts,
            "addresses": addresses,
            "delivery_preferences": delivery_prefs,
            "identity": identity,
            "errors": None,
        },
    )


@router.post("/{customer_id}", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def update_customer(
    request: Request,
    customer_id: str,
    identity=Depends(current_identity),
):
    """Update an existing customer from form data."""
    customer = service.get_customer(customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")
    
    try:
        form_data = await request.form()
        
        # Parse contacts
        contacts_json = form_data.get("contacts_json", "[]")
        try:
            contacts_list = json.loads(contacts_json) if contacts_json else []
        except json.JSONDecodeError:
            contacts_list = []
        
        # Parse addresses
        addresses_json = form_data.get("addresses_json", "[]")
        try:
            addresses_list = json.loads(addresses_json) if addresses_json else []
        except json.JSONDecodeError:
            addresses_list = []
        
        # Parse delivery preferences
        delivery_prefs_json = form_data.get("delivery_preferences_json", "{}")
        try:
            delivery_prefs_dict = json.loads(delivery_prefs_json) if delivery_prefs_json else {}
        except json.JSONDecodeError:
            delivery_prefs_dict = {}
        
        # Convert to Pydantic models
        from app.customers.schemas import ContactInput, AddressInput, DeliveryPreferencesInput
        
        contacts = [ContactInput(**c) for c in contacts_list]
        addresses = [AddressInput(**a) for a in addresses_list]
        delivery_prefs = DeliveryPreferencesInput(**delivery_prefs_dict) if delivery_prefs_dict else None
        
        # Build payload
        payload = CustomerUpdateRequest(
            name=form_data.get("name", ""),
            abn=form_data.get("abn") or None,
            tax_id=form_data.get("tax_id") or None,
            status=form_data.get("status", "Active"),
            contacts=contacts,
            delivery_addresses=addresses,
            delivery_preferences=delivery_prefs,
            payment_terms=form_data.get("payment_terms") or None,
            credit_limit=float(form_data.get("credit_limit")) if form_data.get("credit_limit") else None,
            currency_preference=form_data.get("currency_preference", "AUD"),
            notes=form_data.get("notes") or None,
            internal_notes=form_data.get("internal_notes") or None,
        )
        
        customer = service.update_customer(customer_id, payload)
        return RedirectResponse(url=f"/customers/{customer.id}", status_code=303)
        
    except (ValidationError, ValueError, DomainError) as e:
        # Return form with errors
        error_msg = str(e)
        if isinstance(e, ValidationError):
            error_msg = "; ".join([f"{err['loc']}: {err['msg']}" for err in e.errors()])
        
        # Parse JSON fields for form
        contacts = customer.contacts.get("items", []) if isinstance(customer.contacts, dict) else []
        addresses = customer.delivery_addresses.get("items", []) if isinstance(customer.delivery_addresses, dict) else []
        delivery_prefs = customer.delivery_preferences if isinstance(customer.delivery_preferences, dict) else {}
        
        return templates.TemplateResponse(
            "customers/edit.html",
            {
                "request": request,
                "customer": customer,
                "contacts": contacts,
                "addresses": addresses,
                "delivery_preferences": delivery_prefs,
                "identity": identity,
                "errors": error_msg,
                "form_data": dict(form_data),
            },
            status_code=400,
        )
