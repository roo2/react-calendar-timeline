from __future__ import annotations

from typing import Any, Callable, Dict, List

from fastapi import Depends, HTTPException, Request, status


async def current_identity(request: Request) -> Dict[str, Any]:
    """
    Returns a dict with the current authenticated identity:
    { "user": Any|None, "roles": list[str], "csrf": str|None }
    Uses request.state values set by middleware or tests; avoids DB calls.
    """
    user = getattr(request.state, "user", None)
    roles = getattr(request.state, "roles", []) or []
    csrf = getattr(request.state, "csrf", None)
    return {"user": user, "roles": roles, "csrf": csrf}


def require_roles(*roles_required: str) -> Callable[..., Any]:
    """
    Dependency that enforces the caller has ALL roles in roles_required.
    """
    def dep(identity: Dict[str, Any] = Depends(current_identity)) -> Dict[str, Any]:
        have: List[str] = identity.get("roles", []) or []
        if not set(roles_required).issubset(set(have)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        return identity

    return dep


def allow_roles_any(*roles_allowed: str) -> Callable[..., Any]:
    """
    Dependency that allows the caller if they have ANY role in roles_allowed.
    """
    def dep(identity: Dict[str, Any] = Depends(current_identity)) -> Dict[str, Any]:
        have: List[str] = identity.get("roles", []) or []
        if not set(roles_allowed).intersection(set(have)):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        return identity

    return dep


def require_capability(capability: str) -> Callable[..., Any]:
    """
    Minimal capability enforcement used by System Admin areas.
    """
    def dep(identity: Dict[str, Any] = Depends(current_identity)) -> Dict[str, Any]:
        roles: List[str] = identity.get("roles", []) or []
        if capability == "system_admin" and "SYS_ADMIN" not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        return identity

    return dep


def csrf_protect() -> Callable[..., Any]:
    """
    Double-submit CSRF protection (no-op unless identity provides a token).
    If identity.csrf is set, require header X-CSRF-Token to match.
    As a fallback for non-AJAX form posts, also accept form field "_csrf".
    """
    async def dep(request: Request, identity: Dict[str, Any] = Depends(current_identity)) -> bool:
        expected = identity.get("csrf")
        if expected:
            token = request.headers.get("x-csrf-token") or request.headers.get("X-CSRF-Token")
            if token != expected:
                try:
                    form = await request.form()
                    form_token = form.get("_csrf")
                except Exception:
                    form = None
                    form_token = None
                if form_token != expected:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN)
        return True

    return dep


__all__ = ["current_identity", "require_roles", "allow_roles_any", "require_capability", "csrf_protect"]

