from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

from app.auth.service import AuthService
from app.config import settings
from app.db.session import SessionLocal


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

        if sid:
            try:
                svc = AuthService(SessionLocal())
                user, roles, csrf = svc.get_current_user(sid)

                # Debug logging (can be removed in production)
                import logging
                logger = logging.getLogger("auth")
                logger.debug(
                    "identity_mw sid=%s user=%s roles=%s found=%s",
                    sid[:8] + "..." if len(sid) > 8 else sid,
                    getattr(user, "username", None) if user else None,
                    roles,
                    user is not None,
                )
            except Exception as e:
                # Log error but don't fail the request - treat as anonymous
                import logging
                logging.getLogger("auth").warning(
                    "identity_mw_error sid=%s err=%s",
                    sid[:8] + "..." if len(sid) > 8 else sid if sid else "None",
                    str(e),
                )
                user, roles, csrf = None, [], None
        else:
            import logging
            logging.getLogger("auth").debug("identity_mw no_session_cookie")

        # Set individual attributes for current_identity dependency
        request.state.user = user
        request.state.roles = roles
        request.state.csrf = csrf

        # Also set identity dict for templates that might access it directly
        # This ensures compatibility with both dependency injection and direct access
        request.state.identity = {
            "user": user,  # User object (or None)
            "roles": roles,  # List of role code strings
            "csrf": csrf,  # CSRF token string (or None)
        }

        return await call_next(request)
