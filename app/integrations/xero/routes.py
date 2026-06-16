from __future__ import annotations

from datetime import timedelta
from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.auth.deps import allow_roles_any, csrf_protect, require_roles
from app.config import settings
from app.db.session import SessionLocal
from app.integrations.xero.service import (
    XeroApiError,
    XeroConfigError,
    XeroOAuthError,
    authorize_url,
    connection_status,
    consume_oauth_state,
    create_draft_quote,
    create_xero_contact_for_customer,
    compare_xero_app_customer_match,
    create_oauth_state,
    delete_deletable_unlinked_customers,
    disconnect_xero,
    exchange_authorization_code,
    export_order_to_xero_invoice,
    import_xero_customer_links,
    manual_link_xero_customer,
    merge_customer_with_xero,
    list_linked_customers_for_merge,
    preview_deletable_unlinked_customers,
    preview_xero_customer_links,
    refresh_tokens,
    search_xero_contacts,
    search_app_customers_for_xero_link,
    search_app_customers_for_xero_sync,
    set_tenant_id,
    sync_customer_from_xero,
    sync_customer_to_xero,
    unlinked_xero_customer_review,
    xero_configured,
    xero_get_endpoint,
)

router = APIRouter(prefix="/api/xero", tags=["xero"])

_sys_admin = require_roles("SYS_ADMIN")
SysAdminIdentity = Annotated[dict, Depends(_sys_admin)]
_sales_or_admin = allow_roles_any("SALES", "PROD_MANAGER")
SalesOrAdminIdentity = Annotated[dict, Depends(_sales_or_admin)]


def _frontend_admin_xero_url(*, error: str | None = None, ok: bool = False) -> str:
    base = "/admin/xero"
    if ok:
        return f"{base}?xero=connected"
    if error:
        return f"{base}?xero=error&detail={quote(error, safe='')}"
    return base


def _oauth_callback_response(
    request: Request,
    *,
    code: str | None,
    state: str | None,
    error: str | None,
    error_description: str | None,
) -> RedirectResponse:
    del request  # reserved for future parity with MYOB callback quirks
    if error:
        msg = error_description or error
        return RedirectResponse(url=_frontend_admin_xero_url(error=msg), status_code=302)
    if not code:
        return RedirectResponse(url=_frontend_admin_xero_url(error="missing_code"), status_code=302)

    redirect_uri = settings.XERO_REDIRECT_URI.strip()

    with SessionLocal() as db:
        if not consume_oauth_state(db, state):
            return RedirectResponse(
                url=_frontend_admin_xero_url(error="invalid_state"),
                status_code=302,
            )
        try:
            exchange_authorization_code(db, code=code, redirect_uri=redirect_uri)
        except XeroConfigError as e:
            return RedirectResponse(url=_frontend_admin_xero_url(error=str(e)), status_code=302)
        except XeroOAuthError as e:
            return RedirectResponse(url=_frontend_admin_xero_url(error=str(e)), status_code=302)

    return RedirectResponse(url=_frontend_admin_xero_url(ok=True), status_code=302)


@router.get("/status")
async def xero_status(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        return connection_status(db)


@router.get("/oauth/start")
async def xero_oauth_start(_identity: SysAdminIdentity):
    del _identity
    if not xero_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Xero is not configured (set XERO_CLIENT_ID and XERO_CLIENT_SECRET).",
        )
    with SessionLocal() as db:
        state = create_oauth_state(db)
    url = authorize_url(state=state)
    return RedirectResponse(url=url, status_code=302)


@router.get("/oauth/callback")
async def xero_oauth_callback(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    return _oauth_callback_response(
        request,
        code=code,
        state=state,
        error=error,
        error_description=error_description,
    )


class XeroTenantBody(BaseModel):
    tenant_id: str = Field(
        ...,
        min_length=1,
        description="Organisation tenantId from GET https://api.xero.com/connections",
    )


@router.post("/tenant", dependencies=[Depends(csrf_protect())])
async def xero_set_tenant(_identity: SysAdminIdentity, body: XeroTenantBody):
    del _identity
    with SessionLocal() as db:
        try:
            set_tenant_id(db, tenant_id=body.tenant_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"ok": True}


@router.post("/refresh", dependencies=[Depends(csrf_protect())])
async def xero_refresh(_identity: SysAdminIdentity):
    del _identity
    if not xero_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Xero is not configured.",
        )
    with SessionLocal() as db:
        try:
            did = refresh_tokens(db, log_access_token=False)
        except (XeroOAuthError, XeroConfigError) as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"ok": True, "refreshed": bool(did)}


@router.post("/disconnect", dependencies=[Depends(csrf_protect())])
async def xero_disconnect(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        disconnect_xero(db)
    return {"ok": True}


class XeroGetEndpointBody(BaseModel):
    endpoint: str = Field(
        ...,
        min_length=1,
        description="Relative Xero Accounting API endpoint, e.g. /Contacts?page=1",
    )


@router.post("/api-get", dependencies=[Depends(csrf_protect())])
async def xero_api_get(_identity: SysAdminIdentity, body: XeroGetEndpointBody):
    del _identity
    with SessionLocal() as db:
        try:
            return xero_get_endpoint(db, endpoint=body.endpoint)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/customers/link-preview")
async def xero_customer_link_preview(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        try:
            return preview_xero_customer_links(db)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/customers/link-import", dependencies=[Depends(csrf_protect())])
async def xero_customer_link_import(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        try:
            return import_xero_customer_links(db)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/customers/unlinked")
async def xero_unlinked_customer_review(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        return unlinked_xero_customer_review(db)


class XeroCreateContactBody(BaseModel):
    customer_id: str = Field(..., min_length=1)


@router.post("/customers/create-contact", dependencies=[Depends(csrf_protect())])
async def xero_create_contact_for_customer(_identity: SysAdminIdentity, body: XeroCreateContactBody):
    del _identity
    with SessionLocal() as db:
        try:
            return create_xero_contact_for_customer(db, customer_id=body.customer_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/contacts")
async def xero_search_contacts(
    _identity: SysAdminIdentity,
    q: str | None = None,
    limit: int = 50,
):
    del _identity
    with SessionLocal() as db:
        try:
            items = search_xero_contacts(db, query=q, limit=limit)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
    return {"items": items}


@router.get("/customers/search-for-link")
async def xero_search_app_customers_for_link(
    _identity: SysAdminIdentity,
    q: str | None = None,
    limit: int = 50,
):
    del _identity
    with SessionLocal() as db:
        return {"items": search_app_customers_for_xero_link(db, query=q, limit=limit)}


class XeroManualCustomerLinkBody(BaseModel):
    customer_id: str = Field(..., min_length=1)
    contact_id: str = Field(..., min_length=1, description="Xero ContactID (UUID)")


@router.get("/customers/match-compare")
async def xero_customer_match_compare(
    _identity: SysAdminIdentity,
    customer_id: str,
    contact_id: str | None = None,
):
    del _identity
    with SessionLocal() as db:
        try:
            return compare_xero_app_customer_match(
                db,
                customer_id=customer_id,
                contact_id=contact_id,
            )
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.post("/customers/manual-link", dependencies=[Depends(csrf_protect())])
async def xero_manual_customer_link(_identity: SysAdminIdentity, body: XeroManualCustomerLinkBody):
    del _identity
    with SessionLocal() as db:
        try:
            return manual_link_xero_customer(
                db,
                customer_id=body.customer_id,
                contact_id=body.contact_id,
            )
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/customers/search-for-sync")
async def xero_search_app_customers_for_sync(
    _identity: SysAdminIdentity,
    q: str | None = None,
    limit: int = 50,
):
    del _identity
    with SessionLocal() as db:
        return {"items": search_app_customers_for_xero_sync(db, query=q, limit=limit)}


class XeroSyncCustomerFromXeroBody(BaseModel):
    customer_id: str = Field(..., min_length=1)


@router.post("/customers/sync-from-xero", dependencies=[Depends(csrf_protect())])
async def xero_sync_customer_from_xero(_identity: SysAdminIdentity, body: XeroSyncCustomerFromXeroBody):
    del _identity
    with SessionLocal() as db:
        try:
            return sync_customer_from_xero(db, customer_id=body.customer_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


class XeroSyncCustomerToXeroBody(BaseModel):
    customer_id: str = Field(..., min_length=1)


@router.post("/customers/sync-to-xero", dependencies=[Depends(csrf_protect())])
async def xero_sync_customer_to_xero(_identity: SysAdminIdentity, body: XeroSyncCustomerToXeroBody):
    del _identity
    with SessionLocal() as db:
        try:
            return sync_customer_to_xero(db, customer_id=body.customer_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


class XeroMergeCustomerBody(BaseModel):
    customer_id: str = Field(..., min_length=1)


@router.post("/customers/merge", dependencies=[Depends(csrf_protect())])
async def xero_merge_customer(_identity: SysAdminIdentity, body: XeroMergeCustomerBody):
    del _identity
    with SessionLocal() as db:
        try:
            return merge_customer_with_xero(db, customer_id=body.customer_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


@router.get("/customers/merge-all/preview")
async def xero_merge_all_linked_customers_preview(
    _identity: SysAdminIdentity,
    skip_synced_within_hours: float = 1.0,
):
    del _identity
    hours = max(0.0, float(skip_synced_within_hours))
    skip_within = timedelta(hours=hours) if hours > 0 else None
    with SessionLocal() as db:
        return list_linked_customers_for_merge(db, skip_synced_within=skip_within)


@router.get("/customers/unlinked/deletable-preview")
async def xero_deletable_unlinked_customers_preview(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        return preview_deletable_unlinked_customers(db)


@router.post("/customers/unlinked/delete", dependencies=[Depends(csrf_protect())])
async def xero_delete_deletable_unlinked_customers(_identity: SysAdminIdentity):
    del _identity
    with SessionLocal() as db:
        return delete_deletable_unlinked_customers(db)


@router.post("/orders/{order_id}/invoice", dependencies=[Depends(csrf_protect())])
async def xero_export_order_invoice(order_id: str, _identity: SalesOrAdminIdentity):
    del _identity
    with SessionLocal() as db:
        try:
            return export_order_to_xero_invoice(db, order_id=order_id)
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e


class XeroDraftQuoteBody(BaseModel):
    customer_id: str = Field(..., min_length=1)
    title: str = Field("Quote", max_length=255)
    line_description: str = Field("Line item", max_length=4000)
    quantity: float = Field(1.0, gt=0)
    unit_amount: float = Field(0.0)


@router.post("/quotes/draft", dependencies=[Depends(csrf_protect())])
async def xero_create_draft_quote(_identity: SysAdminIdentity, body: XeroDraftQuoteBody):
    del _identity
    with SessionLocal() as db:
        try:
            out = create_draft_quote(
                db,
                customer_id=body.customer_id,
                title=body.title,
                line_description=body.line_description,
                quantity=body.quantity,
                unit_amount=body.unit_amount,
            )
        except XeroConfigError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
        except XeroOAuthError as e:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e)) from e
        except XeroApiError as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e
    return out
