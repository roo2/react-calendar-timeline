from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from app.auth.deps import require_roles, allow_roles_any, csrf_protect, current_identity
from app.products import service
from app.products.schemas import (
    CreateProductRequest,
    CreateProductVersionRequest,
    OperatorSuggestionRequest,
    SpecPayload,
    compute_derived_dimensions,
)
from app.customers.service import list_customers
from pydantic import ValidationError
from app.exceptions import DomainError

templates = Jinja2Templates(directory="app/templates")

router = APIRouter(prefix="/products", tags=["products"])
suggestions_router = APIRouter(prefix="/suggestions", tags=["suggestions"])


@router.get("/", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def list_products(request: Request, q: Optional[str] = None, identity=Depends(current_identity)):
    """List all products with optional search."""
    try:
        products = service.search_products(q)
        return templates.TemplateResponse(
            "products/index.html", {"request": request, "products": products, "q": q or "", "identity": identity}
        )
    except Exception as e:
        import logging
        import traceback
        logging.getLogger("products").error(f"Error in list_products: {e}")
        logging.getLogger("products").error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"Error loading products: {str(e)}")


@router.get("/new", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER"))], response_class=HTMLResponse)
async def new_product(request: Request, identity=Depends(current_identity)):
    customers = list_customers()
    return templates.TemplateResponse(
        "products/new.html", {"request": request, "identity": identity, "customers": customers, "errors": None}
    )


@router.post("", dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def create_product(
    request: Request,
    customer_id: str = Form(...),
    code: str = Form(...),
    spec_json: str = Form(...),
    identity=Depends(current_identity),
):
    try:
        spec = SpecPayload.parse_raw(spec_json)
        payload = CreateProductRequest(customer_id=customer_id, code=code, spec=spec)
        product, _ = service.create_product_with_version(payload, created_by=(identity.get("user") or "system"))
        return RedirectResponse(url=f"/products/{product.id}", status_code=303)
    except (ValidationError, DomainError) as e:
        customers = list_customers()
        return templates.TemplateResponse(
            "products/new.html",
            {
                "request": request,
                "identity": identity,
                "customers": customers,
                "errors": str(e),
                "prefill_spec_json": spec_json,
                "customer_id": customer_id,
                "code": code,
            },
            status_code=400,
        )


@router.get("/{product_id}", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER", "OPERATOR"))])
async def show_product(request: Request, product_id: str, identity=Depends(current_identity)):
    product = service.get_with_versions(product_id)
    suggestions = service.list_suggestions(product_id, status="open")
    return templates.TemplateResponse(
        "products/show.html",
        {"request": request, "product": product, "identity": identity, "suggestions": suggestions},
    )


@router.get("/{product_id}/versions/{version_id}", response_class=HTMLResponse)
async def show_version(request: Request, product_id: str, version_id: str, identity=Depends(current_identity)):
    product = service.get_with_versions(product_id)
    version = service.get_version(version_id)
    if not product or not version:
        raise HTTPException(status_code=404)
    from app.products.schemas import SpecPayload

    spec = SpecPayload(**version.spec_payload) if version.spec_payload else None
    routing = service.derive_operation_routing(spec) if spec else {"operations": [], "warnings": []}
    return templates.TemplateResponse(
        "products/version_show.html",
        {"request": request, "product": product, "version": version, "routing": routing, "identity": identity},
    )


@router.get(
    "/{product_id}/versions/new",
    dependencies=[Depends(require_roles("PROD_MANAGER"))],
    response_class=HTMLResponse,
)
async def new_version(request: Request, product_id: str, identity=Depends(current_identity)):
    product = service.get_with_versions(product_id)
    return templates.TemplateResponse(
        "products/version_form.html",
        {
            "request": request,
            "product": product,
            "identity": identity,  # pass identity for role UI
            "initial_spec_json": (product.active_version.spec_payload if product.active_version else {}),
            "errors": None,
        },
    )


@router.post(
    "/{product_id}/versions",
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def create_product_version(
    request: Request,
    product_id: str,
    spec_json: str = Form(...),
    identity=Depends(current_identity),
):
    try:
        spec = SpecPayload.parse_raw(spec_json)
        payload = CreateProductVersionRequest(spec=spec)
        version = service.create_new_version(product_id, payload, created_by=(identity.get("user") or "system"))
        return RedirectResponse(url=f"/products/{product_id}/versions/{version.id}", status_code=303)
    except (ValidationError, DomainError) as e:
        product = service.get_with_versions(product_id)
        return templates.TemplateResponse(
            "products/version_form.html",
            {
                "request": request,
                "product": product,
                "identity": identity,
                "initial_spec_json": spec_json,
                "errors": str(e),
            },
            status_code=400,
        )


@router.post(
    "/{product_id}/suggestions",
    dependencies=[Depends(allow_roles_any("OPERATOR", "PROD_MANAGER")), Depends(csrf_protect())],
)
async def create_suggestion(
    request: Request, product_id: str, suggestion_text: str = Form(...), category: Optional[str] = Form(None), identity=Depends(current_identity)
):
    req = OperatorSuggestionRequest(product_id=product_id, suggestion_text=suggestion_text, category=category)
    service.create_suggestion(req, created_by=(identity.get("user") or "operator"))
    return RedirectResponse(url=f"/products/{product_id}", status_code=303)


@router.post("/preview/dimensions", response_class=HTMLResponse, dependencies=[Depends(allow_roles_any("SALES", "PROD_MANAGER")), Depends(csrf_protect())])
async def preview_dimensions(request: Request, spec_json: str = Form(...)):
    spec = SpecPayload.parse_raw(spec_json)
    derived = compute_derived_dimensions(spec)
    return templates.TemplateResponse(
        "products/_derived_dimensions.html", {"request": request, "derived": derived}
    )


@router.get("/{product_id}/versions/{version_id}/print", response_class=HTMLResponse)
async def print_job_sheet(request: Request, product_id: str, version_id: str):
    product = service.get_with_versions(product_id)
    version = service.get_version(version_id)
    if not product or not version:
        raise HTTPException(status_code=404, detail="Product or version not found")
    return templates.TemplateResponse(
        "products/job_sheet_print.html", {"request": request, "product": product, "version": version}
    )

@suggestions_router.get("", dependencies=[Depends(require_roles("PROD_MANAGER"))], response_class=HTMLResponse)
async def list_suggestions(request: Request, identity=Depends(current_identity)):
    suggestions = service.list_suggestions(status="open")
    return templates.TemplateResponse(
        "suggestions/index.html", {"request": request, "identity": identity, "suggestions": suggestions}
    )


@suggestions_router.post(
    "/{suggestion_id}/resolve",
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def resolve_suggestion(request: Request, suggestion_id: str, decision: str = Form(...), identity=Depends(current_identity)):
    service.resolve_suggestion(suggestion_id, decision, resolver=(identity.get("user") or "prod_manager"))
    return RedirectResponse(url="/suggestions", status_code=303)


