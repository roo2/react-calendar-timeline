from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.deps import require_roles, csrf_protect, current_identity
from app.inventory.schemas import ReceiveInventoryRequest, AdjustInventoryRequest, TransactionFilters
from app.inventory.service import get_dashboard as svc_get_dashboard, receive as svc_receive, adjust as svc_adjust, list_transactions as svc_list

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("/dashboard", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def inventory_dashboard():
    snapshot = svc_get_dashboard()
    return snapshot


@router.get("/transactions", dependencies=[Depends(require_roles("PROD_MANAGER"))])
async def inventory_transactions(
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
    return {"items": items, "total": total, "filters": filters}


@router.post(
    "/receive",
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def inventory_receive(payload: ReceiveInventoryRequest, identity=Depends(current_identity)):
    created_by = (identity or {}).get("user") or "unknown"
    svc_receive(payload, created_by=getattr(created_by, "username", created_by))
    return JSONResponse(status_code=200, content={"ok": True})


@router.post(
    "/adjust",
    dependencies=[Depends(require_roles("PROD_MANAGER")), Depends(csrf_protect())],
)
async def inventory_adjust(payload: AdjustInventoryRequest, identity=Depends(current_identity)):
    created_by = (identity or {}).get("user") or "unknown"
    svc_adjust(payload, created_by=getattr(created_by, "username", created_by))
    return JSONResponse(status_code=200, content={"ok": True})


