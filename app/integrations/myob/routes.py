from __future__ import annotations

from typing import Annotated, Any, Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import joinedload

from app.auth.deps import csrf_protect, require_roles
from app.config import settings
from app.db.models.domain import MyobIncomeAccount, MyobItemSellingUom
from app.db.session import SessionLocal
from app.integrations.myob.customer_import import import_customers_from_myob
from app.integrations.myob.item_selling_uom_cache import (
    item_selling_uom_summary,
    rebuild_myob_item_selling_uom_cache,
)
from app.integrations.myob.order_import import import_one_myob_sale_order
from app.integrations.myob.myob_import_job import get_import_job, resume_import_job, start_import_job
from app.integrations.myob.myob_import_pipeline import run_myob_import_pipeline
from app.integrations.myob.order_import_batch import import_all_myob_sale_orders, import_myob_sale_orders_list_page
from app.integrations.myob.service import (
    MyobApiError,
    MyobConfigError,
    MyobOAuthError,
    authorize_url,
    connection_status,
    consume_oauth_state,
    create_oauth_state,
    disconnect_myob,
    exchange_authorization_code,
    fetch_customers_readonly_preview,
    fetch_sale_invoice_items_list_readonly,
    fetch_sale_order_detail_readonly,
    fetch_sale_orders_list_readonly,
    fetch_myob_url_readonly,
    myob_configured,
    refresh_tokens,
    save_company_file_id,
    set_business_id,
)

router = APIRouter(prefix="/api/myob", tags=["myob"])

_sys_admin = require_roles("SYS_ADMIN")
SysAdminIdentity = Annotated[dict, Depends(_sys_admin)]


class MyobIncomeAccountDTO(BaseModel):
    """Cached GL income account (Crown Pack MYOB sync or Dolphin TSV import; read-only in admin UI)."""

    id: str
    brand_source: str
    myob_account_uid: str | None = None
    name: str | None = None
    display_id: str | None = None
    synced_at: str | None = None


class MyobItemSellingUomRowDTO(BaseModel):
    """One cached MYOB ``Inventory/Item`` row (read-only in admin UI)."""

    myob_item_uid: str
    selling_unit_of_measure: str | None = None
    is_bought: bool | None = None
    is_sold: bool | None = None
    is_inventoried: bool | None = None
    myob_income_account_uid: str | None = None
    income_account_display_id: str | None = None
    income_account_name: str | None = None
    synced_at: str | None = None


class MyobItemSellingUomListResponse(BaseModel):
    total: int
    items: list[MyobItemSellingUomRowDTO]


def _business_id_from_query(request: Request, explicit: str | None) -> str | None:
    """MYOB may send `businessId` with varying casing; merge with explicit FastAPI param."""
    if explicit and str(explicit).strip():
        return str(explicit).strip()
    for key, value in request.query_params.multi_items():
        kl = key.lower()
        if kl in ("businessid", "business_id") and value and str(value).strip():
            return str(value).strip()
    return None


def _frontend_admin_myob_url(*, error: str | None = None, ok: bool = False) -> str:
    base = "/admin/myob"
    if ok:
        return f"{base}?myob=connected"
    if error:
        return f"{base}?myob=error&detail={quote(error, safe='')}"
    return base


def _oauth_callback_response(
    request: Request,
    *,
    code: str | None,
    state: str | None,
    businessId: str | None,
    error: str | None,
    error_description: str | None,
) -> RedirectResponse:
    if error:
        msg = error_description or error
        return RedirectResponse(url=_frontend_admin_myob_url(error=msg), status_code=302)
    if not code:
        return RedirectResponse(url=_frontend_admin_myob_url(error="missing_code"), status_code=302)

    redirect_uri = settings.MYOB_REDIRECT_URI.strip()

    with SessionLocal() as db:
        if not consume_oauth_state(db, state):
            return RedirectResponse(
                url=_frontend_admin_myob_url(error="invalid_state"),
                status_code=302,
            )
        try:
            exchange_authorization_code(db, code=code, redirect_uri=redirect_uri)
            bid = _business_id_from_query(request, businessId)
            if bid:
                set_business_id(db, bid)
        except MyobConfigError as e:
            return RedirectResponse(url=_frontend_admin_myob_url(error=str(e)), status_code=302)
        except MyobOAuthError as e:
            return RedirectResponse(url=_frontend_admin_myob_url(error=str(e)), status_code=302)

    return RedirectResponse(url=_frontend_admin_myob_url(ok=True), status_code=302)


@router.get("/status")
async def myob_status(_identity: SysAdminIdentity):
    del _identity  # enforced by dependency
    with SessionLocal() as db:
        return connection_status(db)


@router.get("/oauth/start")
async def myob_oauth_start(_identity: SysAdminIdentity):
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        state = create_oauth_state(db)
    url = authorize_url(state=state)
    return RedirectResponse(url=url, status_code=302)


@router.get("/oauth/callback")
async def myob_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    businessId: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    return _oauth_callback_response(
        request,
        code=code,
        state=state,
        businessId=businessId,
        error=error,
        error_description=error_description,
    )


@router.get("", include_in_schema=False)
async def myob_oauth_callback_registered_at_api_myob(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    businessId: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    """
    Alternate callback path for MYOB apps registered with redirect URI exactly `.../api/myob`
    (no `/oauth/callback` suffix). MYOB appends ?code=...&businessId=... to the registered URL.
    """
    if code is None and error is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return _oauth_callback_response(
        request,
        code=code,
        state=state,
        businessId=businessId,
        error=error,
        error_description=error_description,
    )


class MyobCompanyFileIdBody(BaseModel):
    business_id: str = Field(..., min_length=1, description="MYOB company file GUID from OAuth or AccountRight API.")


class MyobGetJsonBody(BaseModel):
    """
    Absolute GET URL under the connected company file, e.g.
    ``https://api.myob.com/accountright/{companyFileId}/Inventory/Item/{itemUid}``.

    Host must be ``api.myob.com`` or ``*.api.myob.com``; path must match the configured company file id.
    """

    url: str = Field(..., min_length=1, description="https://…/accountright/{companyFileId}/…")


class MyobSaleOrdersListBody(BaseModel):
    """OData paging for ``GET .../Sale/Order`` (MYOB default page size up to 1000)."""

    top: int = Field(20, ge=1, le=1000, description="$top — max rows in this response (MYOB caps at 1000).")
    skip: int = Field(0, ge=0, le=10_000_000, description="$skip — offset into the full ordered list.")


class MyobSaleInvoiceItemsListBody(MyobSaleOrdersListBody):
    """OData paging for ``GET .../Sale/Invoice/Item`` (item-type sale invoices; MYOB caps ``$top`` at 1000)."""


class MyobImportOrdersBatchBody(BaseModel):
    """Import each sale order from one MYOB list page (``GET .../Sale/Order?$top&$skip``), same as *list sale orders* preview."""

    top: int = Field(50, ge=1, le=1000, description="Number of orders to list and import from this page (default 50).")
    skip: int = Field(0, ge=0, le=10_000_000, description="OData $skip — offset into MYOB’s ordered list (0 = first page).")


class MyobImportAllOrdersBody(BaseModel):
    """Page through ``GET …/Sale/Order`` and import every row (OData ``NextPageLink`` or ``$skip`` when next link is absent)."""

    top: int = Field(
        200,
        ge=1,
        le=1000,
        description="List page size ($top) while walking all sale orders; MYOB caps at 1000.",
    )


class MyobImportPipelineBody(BaseModel):
    """
    Run customer sync, rebuild the MYOB item UOM cache, then import sale orders — in that order, in one request.
    """

    orders: Literal["all", "page"] = Field(
        "all",
        description=(
            "``all`` walks every ``GET …/Sale/Order`` page until empty (same as ``/orders/import-all``). "
            "``page`` imports a single list page (same as ``/orders/import-from-list``)."
        ),
    )
    orders_top: int = Field(
        200,
        ge=1,
        le=1000,
        description="OData ``$top`` for sale orders: page size when listing all pages, or rows for a single page.",
    )
    orders_skip: int = Field(
        0,
        ge=0,
        le=10_000_000,
        description="OData ``$skip`` when ``orders`` is ``page``; ignored when ``orders`` is ``all``.",
    )


class MyobImportPipelineStartResponse(BaseModel):
    """Returned immediately when a background import job is queued."""

    job_id: str = Field(..., description="Poll ``GET /api/myob/import/jobs/{job_id}`` until ``status`` is terminal.")
    status_path: str = Field(..., description="Relative URL path for polling this job.")


class MyobImportJobStatusDTO(BaseModel):
    """Background MYOB import job state (stored in the database; pollable from any worker)."""

    job_id: str
    status: Literal["running", "completed", "failed", "interrupted"]
    phase: Literal["customers", "item_cache", "orders", "done"]
    message: str
    orders_mode: Literal["all", "page"]
    orders_top: int
    orders_skip: int
    created_at: str
    updated_at: str
    partial: dict[str, Any] = Field(default_factory=dict, description="Per-step summaries while running.")
    result: dict[str, Any] | None = Field(None, description="Full pipeline outcome when ``status`` is ``completed``.")
    error: str | None = Field(None, description="Set when ``status`` is ``failed``.")


class MyobSaleOrderFetchBody(BaseModel):
    """Fetch one sale order document. Prefer ``order_uri`` from a list row when MYOB provides it."""

    order_uri: str | None = Field(
        None,
        description="Absolute https://api.myob.com/accountright/{companyFileId}/Sale/Order/... URL from list ``URI``.",
    )
    order_uid: str | None = Field(
        None,
        min_length=32,
        max_length=40,
        description="Sale order UID (GUID). Tries Service/Item/Professional/Miscellaneous/TimeBilling paths until one matches.",
    )

    @model_validator(mode="after")
    def require_uri_or_uid(self) -> "MyobSaleOrderFetchBody":
        has_uri = bool(self.order_uri and str(self.order_uri).strip())
        has_uid = bool(self.order_uid and str(self.order_uid).strip())
        if not has_uri and not has_uid:
            raise ValueError("Provide order_uri or order_uid.")
        return self


@router.post("/company-file-id", dependencies=[Depends(csrf_protect())])
async def myob_set_company_file_id(_identity: SysAdminIdentity, body: MyobCompanyFileIdBody):
    """When OAuth does not return businessId in the query string, save the company file GUID manually."""
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            save_company_file_id(db, business_id=body.business_id)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"ok": True, "business_id": body.business_id.strip()}


@router.post("/disconnect", dependencies=[Depends(csrf_protect())])
async def myob_disconnect(_identity: SysAdminIdentity):
    """Clear stored MYOB tokens and company file id locally (does not call MYOB)."""
    del _identity
    with SessionLocal() as db:
        disconnect_myob(db)
    return {"ok": True, "message": "MYOB disconnected on this server."}


@router.post("/import/pipeline", dependencies=[Depends(csrf_protect())])
async def myob_import_pipeline(_identity: SysAdminIdentity, body: MyobImportPipelineBody):
    """
    Consolidated MYOB import: **customers** → **item UOM cache rebuild** (incl. income accounts from items) → **sale orders**.

    Use ``orders: \"all\"`` for a full order walk (same behaviour as ``POST /orders/import-all``), or ``orders: \"page\"``
    with ``orders_top`` / ``orders_skip`` for a single list page (same as ``POST /orders/import-from-list``).
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return run_myob_import_pipeline(
                db,
                orders=body.orders,
                orders_top=body.orders_top,
                orders_skip=body.orders_skip,
            )
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/import/pipeline/start", dependencies=[Depends(csrf_protect())])
async def myob_import_pipeline_start(_identity: SysAdminIdentity, body: MyobImportPipelineBody):
    """
    Queue the same import pipeline as ``POST /import/pipeline`` on a **background thread** and return a ``job_id``.

    Poll ``GET /api/myob/import/jobs/{job_id}`` for ``phase`` / ``message`` updates; when ``status`` is ``completed``,
    ``failed``, or ``interrupted``, read ``result`` or ``error``. Job state is stored in the database (any dyno can poll).
    Only one import may run at a time **app-wide**; if another job is active, returns **409** with the running job
    snapshot in the response body. After an ``interrupted`` or ``failed`` job (with partial progress), call
    ``POST /import/jobs/{job_id}/resume`` to continue.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    job_id, conflict = start_import_job(
        orders=body.orders,
        orders_top=body.orders_top,
        orders_skip=body.orders_skip,
    )
    if job_id is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "message": "Another MYOB import pipeline is already running.",
                "running_job": conflict,
            },
        )
    return MyobImportPipelineStartResponse(job_id=job_id, status_path=f"/api/myob/import/jobs/{job_id}")


@router.get("/import/jobs/{job_id}", response_model=MyobImportJobStatusDTO)
async def myob_import_job_status(_identity: SysAdminIdentity, job_id: str):
    """Poll background import job status (reads persisted state)."""
    del _identity
    row = get_import_job(job_id)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown import job id.")
    return MyobImportJobStatusDTO(**row)


@router.post("/import/jobs/{job_id}/resume", dependencies=[Depends(csrf_protect())])
async def myob_import_job_resume(_identity: SysAdminIdentity, job_id: str):
    """
    Continue a **failed** or **interrupted** import using the same ``job_id`` (partial progress is kept in ``partial``).

    Skips steps that already finished and were committed (customers → item cache → orders).
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    jid, conflict, err = resume_import_job(job_id)
    if err:
        if conflict is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"message": err, "running_job": conflict},
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=err)
    assert jid is not None
    return MyobImportPipelineStartResponse(job_id=jid, status_path=f"/api/myob/import/jobs/{jid}")


@router.post("/customers/sync", dependencies=[Depends(csrf_protect())])
async def myob_customers_sync(_identity: SysAdminIdentity):
    """
    One-way import: upsert local customers from MYOB Contact/Customer (GET-only fetch).
    Matches on myob_customer_uid; repeated runs update existing rows.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return import_customers_from_myob(db)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/income-accounts", response_model=list[MyobIncomeAccountDTO])
async def myob_list_income_accounts(_identity: SysAdminIdentity):
    """
    Read-only: locally cached MYOB income accounts (populated when inventory items are fetched or the
    UOM cache is rebuilt).
    """
    del _identity
    with SessionLocal() as db:
        rows = db.scalars(
            select(MyobIncomeAccount).order_by(
                MyobIncomeAccount.brand_source.asc(),
                MyobIncomeAccount.display_id.asc(),
                MyobIncomeAccount.name.asc(),
                MyobIncomeAccount.id.asc(),
            )
        ).all()
    return [
        MyobIncomeAccountDTO(
            id=r.id,
            brand_source=str(getattr(r, "brand_source", None) or "crownpack"),
            myob_account_uid=r.myob_account_uid,
            name=r.name,
            display_id=r.display_id,
            synced_at=r.synced_at.isoformat() if r.synced_at is not None else None,
        )
        for r in rows
    ]


@router.get("/item-selling-uoms", response_model=MyobItemSellingUomListResponse)
async def myob_list_item_selling_uoms(
    _identity: SysAdminIdentity,
    limit: int = Query(10_000, ge=1, le=25_000),
    offset: int = Query(0, ge=0),
):
    """
    Read-only: locally cached MYOB inventory items (``myob_item_selling_uoms``), joined to income
    account display id/name when known. Does not call MYOB.
    """
    del _identity
    with SessionLocal() as db:
        total = int(db.scalar(select(func.count()).select_from(MyobItemSellingUom)) or 0)
        rows = db.scalars(
            select(MyobItemSellingUom)
            .options(joinedload(MyobItemSellingUom.income_account))
            .order_by(MyobItemSellingUom.myob_item_uid.asc())
            .limit(limit)
            .offset(offset)
        ).all()
    out_items: list[MyobItemSellingUomRowDTO] = []
    for r in rows:
        acc = r.income_account
        out_items.append(
            MyobItemSellingUomRowDTO(
                myob_item_uid=r.myob_item_uid,
                selling_unit_of_measure=r.selling_unit_of_measure,
                is_bought=r.is_bought,
                is_sold=r.is_sold,
                is_inventoried=r.is_inventoried,
                myob_income_account_uid=r.myob_income_account_uid,
                income_account_display_id=acc.display_id if acc is not None else None,
                income_account_name=acc.name if acc is not None else None,
                synced_at=r.synced_at.isoformat() if r.synced_at is not None else None,
            )
        )
    return MyobItemSellingUomListResponse(total=total, items=out_items)


@router.post("/sale/orders/list-preview", dependencies=[Depends(csrf_protect())])
async def myob_sale_orders_list_preview(_identity: SysAdminIdentity, body: MyobSaleOrdersListBody):
    """
    Read-only: GET ``Sale/Order`` with ``$top`` / ``$skip`` for admin testing (subset of all orders).

    Inspect ``myob.Items`` — each row may include ``URI`` (use with ``/sale/orders/fetch-json``) and ``UID``.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return fetch_sale_orders_list_readonly(db, top=body.top, skip=body.skip)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/sale/invoice/items/list-preview", dependencies=[Depends(csrf_protect())])
async def myob_sale_invoice_items_list_preview(_identity: SysAdminIdentity, body: MyobSaleInvoiceItemsListBody):
    """
    Read-only: GET ``Sale/Invoice/Item`` with ``$top`` / ``$skip`` for admin testing (subset of item invoices).

    Inspect ``myob.Items`` for each invoice row (``URI``, ``UID``, line data, etc.).
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return fetch_sale_invoice_items_list_readonly(db, top=body.top, skip=body.skip)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/orders/import-one", dependencies=[Depends(csrf_protect())])
async def myob_import_one_order(_identity: SysAdminIdentity, body: MyobSaleOrderFetchBody):
    """
    Fetch one sale order from MYOB (by URI or UID) and upsert a local `orders` + `order_myob_lines` row.

    Requires the customer to exist (MYOB customer sync) and `sme-inventory` to resolve item UOM from
    ``/Inventory/Item`` for each line.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            detail = fetch_sale_order_detail_readonly(
                db, order_uri=body.order_uri, order_uid=body.order_uid
            )
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        raw = detail.get("myob")
        if not isinstance(raw, dict):
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Invalid MYOB order response.")
        try:
            return import_one_myob_sale_order(db, myob_order=raw, item_fetch=None)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/orders/import-from-list", dependencies=[Depends(csrf_protect())])
async def myob_import_orders_from_list(_identity: SysAdminIdentity, body: MyobImportOrdersBatchBody):
    """
    List ``GET …/Sale/Order`` with ``$top`` / ``$skip`` (default: first 50 rows), then import each order.

    Customers must already be synced from MYOB. Per-order failures are returned in ``errors``; successful
    imports are committed individually.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return import_myob_sale_orders_list_page(db, top=body.top, skip=body.skip)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/orders/import-all", dependencies=[Depends(csrf_protect())])
async def myob_import_all_orders(_identity: SysAdminIdentity, body: MyobImportAllOrdersBody):
    """
    Import every MYOB sale order: list ``Sale/Order`` with OData paging until no more rows, then import
    each (same behaviour as ``/orders/import-from-list`` per page).

    Customers must already be synced from MYOB. Per-order failures are returned in ``errors``; successful
    imports commit individually. If ``truncated`` is true, raise the page cap or re-run later.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return import_all_myob_sale_orders(db, top=body.top)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/sale/orders/fetch-json", dependencies=[Depends(csrf_protect())])
async def myob_sale_order_fetch_json(_identity: SysAdminIdentity, body: MyobSaleOrderFetchBody):
    """Read-only: GET one sale order as JSON (by ``order_uri`` or ``order_uid``)."""
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return fetch_sale_order_detail_readonly(db, order_uri=body.order_uri, order_uid=body.order_uid)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/item-selling-uoms/summary")
async def myob_item_selling_uoms_summary_get(_identity: SysAdminIdentity):
    """
    Cached MYOB inventory item UOMs: total rows and counts grouped by ``SellingUnitOfMeasure``.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        return item_selling_uom_summary(db)


@router.post("/item-selling-uoms/rebuild", dependencies=[Depends(csrf_protect())])
async def myob_item_selling_uoms_rebuild(_identity: SysAdminIdentity):
    """
    Replace the local MYOB item UOM cache by paging ``GET …/Inventory/Item`` (GET-only to MYOB).

    Run after connecting MYOB and setting the company file id; order import then uses the cache
    and only GETs items that are not yet cached.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal.begin() as db:
        try:
            return rebuild_myob_item_selling_uom_cache(db)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/get-json", dependencies=[Depends(csrf_protect())])
async def myob_get_json_arbitrary(_identity: SysAdminIdentity, body: MyobGetJsonBody):
    """
    Read-only: GET any URL under ``/accountright/{companyFileId}/`` the token can access.
    Returns ``{ request_url, myob }`` where ``myob`` is the parsed JSON (object or array).
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return fetch_myob_url_readonly(db, url=body.url)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/customers/preview", dependencies=[Depends(csrf_protect())])
async def myob_customers_preview(_identity: SysAdminIdentity):
    """
    Read-only: GET customers from MYOB Contact/Customer for admin inspection.
    Does not write to MYOB or import into local customers yet.
    """
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            return fetch_customers_readonly_preview(db)
        except MyobConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        except MyobApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/refresh", dependencies=[Depends(csrf_protect())])
async def myob_refresh_manual(_identity: SysAdminIdentity):
    del _identity
    if not myob_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="MYOB is not configured (set MYOB_APP_KEY and MYOB_APP_SECRET).",
        )
    with SessionLocal() as db:
        try:
            did = refresh_tokens(db, log_access_token=True)
        except MyobOAuthError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
        if not did:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No MYOB refresh token stored.",
            )
        return {
            "ok": True,
            "message": "Token refreshed; access token printed on server logs.",
        }
