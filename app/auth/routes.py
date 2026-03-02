from __future__ import annotations

from datetime import timedelta
from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

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
        max_age = int(timedelta(hours=settings.SESSION_TTL_HOURS).total_seconds())
        user, roles, csrf = svc.get_current_user(str(sess.id))
        resp = JSONResponse(
            status_code=200,
            content={
                "ok": True,
                "identity": {"user": (user or {}).get("username") if isinstance(user, dict) else None, "roles": roles, "csrf": csrf},
            },
        )
        resp.set_cookie(
            key=settings.COOKIE_NAME,
            value=str(sess.id),  # Ensure it's a string
            httponly=True,
            samesite="lax",
            secure=(settings.ENV == "prod"),
            max_age=max_age,
            path="/",  # Explicitly set path to root
        )
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
    response.delete_cookie(settings.COOKIE_NAME, path="/")
    return JSONResponse(status_code=200, content={"ok": True})

 
@router.get("/me")
async def me(identity=Depends(current_identity)):
    return {"identity": _public_identity(identity)}


@router.get("/csrf")
async def get_csrf(identity=Depends(current_identity)):
    if not identity.get("user"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return {"csrf_token": identity.get("csrf")}

