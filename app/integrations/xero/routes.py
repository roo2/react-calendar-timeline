from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from app.auth.deps import csrf_protect, require_roles
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
    create_oauth_state,
    disconnect_xero,
    exchange_authorization_code,
    refresh_tokens,
    set_tenant_id,
    xero_configured,
)

router = APIRouter(prefix="/api/xero", tags=["xero"])

_sys_admin = require_roles("SYS_ADMIN")
SysAdminIdentity = Annotated[dict, Depends(_sys_admin)]


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
            return RedirectResponse(url=_frontend_admin_xero_url(error="invalid_state"), status_code=302)
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
    tenant_id: str = Field(..., min_length=1, description="Organisation tenantId from GET https://api.xero.com/connections")


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
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Xero is not configured.")
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
