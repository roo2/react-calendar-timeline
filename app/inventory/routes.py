from __future__ import annotations

from fastapi import APIRouter, Depends, Request, Query
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from app.auth.deps import require_roles, csrf_protect, current_identity
from app.inventory.schemas import ReceiveInventoryRequest, AdjustInventoryRequest, TransactionFilters
from app.inventory.service import get_dashboard as svc_get_dashboard, receive as svc_receive, adjust as svc_adjust, list_transactions as svc_list

router = APIRouter(prefix="/inventory", tags=["inventory"])
templates = Jinja2Templates(directory="app/templates")


@router.get("", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def inventory_dashboard(request: Request):
    snapshot = svc_get_dashboard()
    return templates.TemplateResponse("inventory/index.html", {"request": request, "snapshot": snapshot})


@router.get("/transactions", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def inventory_transactions(
    request: Request,
    category: str | None = Query(default=None),
    item_id: str | None = Query(default=None),
    job_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    created_from: str | None = Query(default=None),
    created_to: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
):
    filters = TransactionFilters(
        category=category,  # type: ignore[arg-type]
        item_id=item_id,    # type: ignore[arg-type]
        job_id=job_id,      # type: ignore[arg-type]
        run_id=run_id,      # type: ignore[arg-type]
        created_from=created_from,
        created_to=created_to,
        page=page,
        page_size=page_size,
    )
    items, total = svc_list(filters)
    return templates.TemplateResponse(
        "inventory/transactions.html",
        {"request": request, "items": items, "total": total, "filters": filters},
    )


@router.get("/receive", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def receive_form(request: Request):
    return templates.TemplateResponse("inventory/receive.html", {"request": request})


@router.post(
    "/receive",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def inventory_receive(request: Request, payload: ReceiveInventoryRequest, identity=Depends(current_identity)):
    created_by = (identity or {}).get("user") or "unknown"
    # Accept both JSON and form submissions
    if request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        payload = ReceiveInventoryRequest(
            item_id=form.get("item_id") or None,
            category=form.get("category") or "raw_material",
            quantity=form.get("quantity"),
            uom=form.get("uom") or "kg",
        )
    svc_receive(payload, created_by=created_by)
    snapshot = svc_get_dashboard()
    # Return balances partial for HTMX swap (or full page includes it)
    return templates.TemplateResponse("inventory/_balances.html", {"request": request, "snapshot": snapshot})


@router.get("/adjust", response_class=HTMLResponse, dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def adjust_form(request: Request):
    return templates.TemplateResponse("inventory/adjust.html", {"request": request})


@router.post(
    "/adjust",
    response_class=HTMLResponse,
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def inventory_adjust(request: Request, payload: AdjustInventoryRequest, identity=Depends(current_identity)):
    created_by = (identity or {}).get("user") or "unknown"
    if request.headers.get("content-type", "").startswith("application/x-www-form-urlencoded"):
        form = await request.form()
        payload = AdjustInventoryRequest(
            category=form.get("category"),
            quantity=form.get("quantity"),
            uom=form.get("uom") or "kg",
            item_id=form.get("item_id") or None,
            note=form.get("note") or None,
        )
    svc_adjust(payload, created_by=created_by)
    snapshot = svc_get_dashboard()
    return templates.TemplateResponse("inventory/_balances.html", {"request": request, "snapshot": snapshot})


