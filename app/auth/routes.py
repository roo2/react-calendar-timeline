from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from app.auth.cookies import apply_session_cookie, clear_session_cookie
from app.auth.deps import current_identity, csrf_protect
from app.auth.service import AuthService, AuthError
from app.config import settings
from app.db.session import SessionLocal

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=4, max_length=128)


def _public_identity(identity: dict) -> dict:
    u = (identity or {}).get("user")
    return {
        "user": (u.get("username") if isinstance(u, dict) else getattr(u, "username", None) if u else None),
        "roles": (identity or {}).get("roles", []) or [],
        "csrf": (identity or {}).get("csrf", None),
    }


@router.post("/login", response_model=None)
async def login(
    request: Request,
    payload: LoginRequest,
) -> Response:
    """Cookie-based login for SPA clients."""
    with SessionLocal() as db:
        svc = AuthService(db, session_ttl_hours=settings.SESSION_TTL_HOURS)
        try:
            sess = svc.login(payload.username, payload.password)
        except AuthError:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"ok": False, "detail": "invalid_credentials"},
            )
        user, roles, csrf = svc.get_current_user(str(sess.id))
        resp = JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "identity": {"user": (user or {}).get("username") if isinstance(user, dict) else None, "roles": roles, "csrf": csrf},
            },
        )
        apply_session_cookie(resp, request, str(sess.id))
        return resp


@router.post("/logout", dependencies=[Depends(csrf_protect())])
async def logout(request: Request, response: Response, identity=Depends(current_identity)) -> JSONResponse:
    sid = request.cookies.get(settings.COOKIE_NAME)
    if sid:
        try:
            with SessionLocal() as db:
                svc = AuthService(db)
                svc.logout(sid)
        except Exception:
            pass
    clear_session_cookie(response, request)
    return JSONResponse(status_code=200, content={"ok": True})

 
@router.get("/me")
async def me(identity=Depends(current_identity)):
    return {"identity": _public_identity(identity)}


@router.get("/csrf")
async def get_csrf(identity=Depends(current_identity)):
    if not identity.get("user"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return {"csrf_token": identity.get("csrf")}

