from __future__ import annotations

from typing import Annotated
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse

from app.auth.deps import csrf_protect, require_roles
from app.config import settings
from app.db.session import SessionLocal
from app.integrations.myob.service import (
    MyobConfigError,
    MyobOAuthError,
    authorize_url,
    connection_status,
    consume_oauth_state,
    create_oauth_state,
    exchange_authorization_code,
    myob_configured,
    refresh_tokens,
    set_business_id,
)

router = APIRouter(prefix="/api/myob", tags=["myob"])

_sys_admin = require_roles("SYS_ADMIN")
SysAdminIdentity = Annotated[dict, Depends(_sys_admin)]


def _frontend_admin_myob_url(*, error: str | None = None, ok: bool = False) -> str:
    base = "/admin/myob"
    if ok:
        return f"{base}?myob=connected"
    if error:
        return f"{base}?myob=error&detail={quote(error, safe='')}"
    return base


def _oauth_callback_response(
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
            if businessId:
                set_business_id(db, businessId)
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
    code: str | None = None,
    state: str | None = None,
    businessId: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
):
    return _oauth_callback_response(
        code=code,
        state=state,
        businessId=businessId,
        error=error,
        error_description=error_description,
    )


@router.get("", include_in_schema=False)
async def myob_oauth_callback_registered_at_api_myob(
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
        code=code,
        state=state,
        businessId=businessId,
        error=error,
        error_description=error_description,
    )


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
