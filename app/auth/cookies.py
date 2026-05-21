from __future__ import annotations

from datetime import timedelta

from starlette.requests import Request
from starlette.responses import Response

from app.config import settings


def is_production_env() -> bool:
    return settings.ENV.strip().lower() in {"prod", "production", "heroku"}


def request_is_https(request: Request) -> bool:
    """Heroku and other reverse proxies set X-Forwarded-Proto."""
    forwarded = request.headers.get("x-forwarded-proto", "")
    if forwarded:
        return forwarded.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def session_cookie_secure(request: Request) -> bool:
    """Use Secure cookies on HTTPS even when ENV is not exactly ``prod``."""
    return is_production_env() or request_is_https(request)


def session_cookie_max_age_seconds() -> int:
    return int(timedelta(hours=settings.SESSION_TTL_HOURS).total_seconds())


def apply_session_cookie(response: Response, request: Request, session_id: str) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=str(session_id),
        httponly=True,
        samesite="lax",
        secure=session_cookie_secure(request),
        max_age=session_cookie_max_age_seconds(),
        path="/",
    )


def clear_session_cookie(response: Response, request: Request) -> None:
    response.delete_cookie(
        settings.COOKIE_NAME,
        path="/",
        secure=session_cookie_secure(request),
        httponly=True,
        samesite="lax",
    )
