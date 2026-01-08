from __future__ import annotations

from datetime import timedelta
from uuid import UUID
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse

from app.auth.deps import current_identity
from app.auth.service import AuthService, AuthError
from app.config import settings
from app.db.session import SessionLocal

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: Optional[str] = None) -> HTMLResponse:
    """Display login page with optional error message."""
    from app.main import templates

    return templates.TemplateResponse(
        "auth/login.html",
        {
            "request": request,
            "title": "Sign In",
            "error": error,
            "identity": {"user": None, "roles": [], "csrf": None},
        },
    )


@router.post("/login", response_model=None)
async def login(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
) -> Response:
    """Handle login form submission. Returns login page with error on failure, redirects on success."""
    from app.main import templates

    # Basic length validation per SDS 11
    if not (3 <= len(username) <= 80) or not (8 <= len(password) <= 128):
        return templates.TemplateResponse(
            "auth/login.html",
            {
                "request": request,
                "title": "Sign In",
                "error": "Username must be 3–80 characters and password must be 8–128 characters.",
                "username": username,
                "identity": {"user": None, "roles": [], "csrf": None},
            },
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        )
    svc = AuthService(SessionLocal(), session_ttl_hours=settings.SESSION_TTL_HOURS)
    try:
        sess = svc.login(username, password)
    except AuthError:
        # Show login page with a friendly error instead of JSON
        return templates.TemplateResponse(
            "auth/login.html",
            {
                "request": request,
                "title": "Sign In",
                "error": "Invalid username or password. Please try again.",
                "username": username,
                "identity": {"user": None, "roles": [], "csrf": None},
            },
            status_code=status.HTTP_401_UNAUTHORIZED,
        )
    max_age = int(timedelta(hours=settings.SESSION_TTL_HOURS).total_seconds())
    # Use direct path for redirect to avoid route-name resolution issues
    resp = RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)
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


@router.post("/logout")
async def logout(request: Request, response: Response, identity=Depends(current_identity)) -> RedirectResponse:
    sid = request.cookies.get(settings.COOKIE_NAME)
    if sid:
        try:
            svc = AuthService(SessionLocal())
            svc.logout(sid)
        except Exception:
            pass
    response.clear_cookie(settings.COOKIE_NAME)
    # Redirect to home after logout
    return RedirectResponse(url="/", status_code=status.HTTP_303_SEE_OTHER)

 
@router.get("/csrf")
async def get_csrf(identity=Depends(current_identity)):
    if not identity.get("user"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED)
    return {"csrf_token": identity.get("csrf")}

