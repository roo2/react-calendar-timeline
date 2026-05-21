from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.auth.cookies import apply_session_cookie
from app.auth.service import AuthService
from app.config import settings
from app.db.session import SessionLocal

_logger = logging.getLogger("auth")


class IdentityMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        """
        Middleware that extracts session ID from cookie and loads user identity.
        Sets request.state.user, request.state.roles, request.state.csrf for dependencies.
        Also sets request.state.identity dict for direct template access.
        """
        sid = request.cookies.get(settings.COOKIE_NAME)
        user = None
        roles: list[str] = []
        csrf = None
        refresh_session_cookie = False

        if sid:
            try:
                with SessionLocal() as db:
                    svc = AuthService(db, session_ttl_hours=settings.SESSION_TTL_HOURS)
                    user, roles, csrf = svc.get_current_user(sid)
                    if user:
                        svc.touch_session_if_needed(sid)
                        refresh_session_cookie = True
                _logger.debug(
                    "identity_mw sid=%s user=%s roles=%s found=%s",
                    sid[:8] + "..." if len(sid) > 8 else sid,
                    (user or {}).get("username") if isinstance(user, dict) else None,
                    roles,
                    user is not None,
                )
            except Exception as e:
                # Log error but don't fail the request - treat as anonymous
                _logger.warning(
                    "identity_mw_error sid=%s err=%s",
                    sid[:8] + "..." if len(sid) > 8 else sid if sid else "None",
                    str(e),
                )
                user, roles, csrf = None, [], None
        else:
            _logger.debug("identity_mw no_session_cookie")

        # Set individual attributes for current_identity dependency
        request.state.user = user
        request.state.roles = roles
        request.state.csrf = csrf

        # Also set identity dict for templates that might access it directly
        # This ensures compatibility with both dependency injection and direct access
        request.state.identity = {
            "user": user,  # {id, username} dict (or None)
            "roles": roles,  # List of role code strings
            "csrf": csrf,  # CSRF token string (or None)
        }

        response = await call_next(request)
        # Rolling browser cookie max-age keeps users signed in across dyno/worker restarts
        # when the DB session is still valid (Heroku Postgres).
        if refresh_session_cookie and sid:
            apply_session_cookie(response, request, sid)
        return response
