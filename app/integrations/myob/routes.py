from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.auth.deps import csrf_protect, require_roles
from app.config import settings
from app.db.session import SessionLocal
from app.integrations.myob.customer_import import import_customers_from_myob
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
    myob_configured,
    refresh_tokens,
    save_company_file_id,
    set_business_id,
)

router = APIRouter(prefix="/api/myob", tags=["myob"])

_sys_admin = require_roles("SYS_ADMIN")
SysAdminIdentity = Annotated[dict, Depends(_sys_admin)]


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
