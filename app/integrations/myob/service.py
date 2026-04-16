from __future__ import annotations

import secrets
import sys
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models.domain import MyobConnection, MyobOAuthState

MYOB_AUTHORIZE_URL = "https://secure.myob.com/oauth2/account/authorize"
MYOB_TOKEN_URL = "https://secure.myob.com/oauth2/v1/authorize"

STATE_TTL = timedelta(minutes=10)


class MyobConfigError(RuntimeError):
    pass


class MyobOAuthError(RuntimeError):
    pass


def myob_configured() -> bool:
    return bool(settings.MYOB_APP_KEY and settings.MYOB_APP_SECRET)


def _require_config() -> None:
    if not myob_configured():
        raise MyobConfigError("MYOB_APP_KEY and MYOB_APP_SECRET must be set")


def _normalize_scopes() -> str:
    return " ".join(s for s in settings.MYOB_SCOPES.replace(",", " ").split() if s)


def cleanup_expired_oauth_states(db: Session) -> None:
    now = datetime.now(UTC)
    db.execute(delete(MyobOAuthState).where(MyobOAuthState.expires_at < now))


def create_oauth_state(db: Session) -> str:
    cleanup_expired_oauth_states(db)
    token = secrets.token_hex(32)
    now = datetime.now(UTC)
    db.add(MyobOAuthState(state=token, expires_at=now + STATE_TTL))
    db.commit()
    return token


def consume_oauth_state(db: Session, state: str | None) -> bool:
    if not state:
        return False
    cleanup_expired_oauth_states(db)
    row = db.get(MyobOAuthState, state)
    if row is None:
        return False
    now = datetime.now(UTC)
    if row.expires_at < now:
        db.delete(row)
        db.commit()
        return False
    db.delete(row)
    db.commit()
    return True


def _singleton(db: Session) -> MyobConnection:
    row = db.get(MyobConnection, 1)
    if row is None:
        row = MyobConnection(id=1)
        db.add(row)
        db.flush()
    return row


def _parse_expires_in(raw: Any) -> int:
    if raw is None:
        return 0
    try:
        return int(float(str(raw)))
    except (TypeError, ValueError):
        return 0


def _post_token_form(body: dict[str, str]) -> dict[str, Any]:
    with httpx.Client(timeout=60.0) as client:
        resp = client.post(
            MYOB_TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise MyobOAuthError(f"MYOB token endpoint error {resp.status_code}: {detail}")
    return resp.json()


def exchange_authorization_code(db: Session, *, code: str, redirect_uri: str) -> None:
    _require_config()
    scopes = _normalize_scopes()
    data = {
        "client_id": settings.MYOB_APP_KEY or "",
        "client_secret": settings.MYOB_APP_SECRET or "",
        "scope": scopes,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    payload = _post_token_form(data)
    _apply_token_payload(db, payload, log_access_token=True)


def refresh_tokens(db: Session, *, log_access_token: bool = False) -> bool:
    """
    Refresh MYOB tokens using the stored refresh token.
    Returns True if refreshed, False if there is nothing to refresh.
    """
    _require_config()
    row = _singleton(db)
    if not row.refresh_token:
        return False
    data = {
        "client_id": settings.MYOB_APP_KEY or "",
        "client_secret": settings.MYOB_APP_SECRET or "",
        "refresh_token": row.refresh_token,
        "grant_type": "refresh_token",
    }
    payload = _post_token_form(data)
    _apply_token_payload(db, payload, log_access_token=log_access_token)
    return True


def _apply_token_payload(
    db: Session,
    payload: dict[str, Any],
    *,
    log_access_token: bool = False,
) -> None:
    row = _singleton(db)
    access = payload.get("access_token")
    refresh = payload.get("refresh_token")
    if refresh:
        row.refresh_token = str(refresh)
    if access:
        row.access_token = str(access)
    exp_s = _parse_expires_in(payload.get("expires_in"))
    now = datetime.now(UTC)
    row.access_token_expires_at = now + timedelta(seconds=exp_s) if exp_s > 0 else None
    row.last_refreshed_at = now
    scope = payload.get("scope")
    if scope is not None:
        row.scope = str(scope)
    user = payload.get("user")
    if isinstance(user, dict):
        uid = user.get("uid")
        if uid is not None:
            row.myob_user_uid = str(uid)
        un = user.get("username")
        if un is not None:
            row.myob_username = str(un)
    db.commit()
    if log_access_token and row.access_token:
        print(f"[MYOB] access_token={row.access_token}", file=sys.stdout, flush=True)


def connection_status(db: Session) -> dict[str, Any]:
    row = db.get(MyobConnection, 1)
    if row is None or not row.refresh_token:
        return {
            "configured": myob_configured(),
            "connected": False,
            "business_id": None,
            "access_token_expires_at": None,
            "last_refreshed_at": None,
            "scope": None,
            "myob_username": None,
        }
    exp_at = row.access_token_expires_at.isoformat() if row.access_token_expires_at else None
    ref_at = row.last_refreshed_at.isoformat() if row.last_refreshed_at else None
    return {
        "configured": myob_configured(),
        "connected": True,
        "business_id": row.business_id,
        "access_token_expires_at": exp_at,
        "last_refreshed_at": ref_at,
        "scope": row.scope,
        "myob_username": row.myob_username,
    }


def set_business_id(db: Session, business_id: str | None) -> None:
    if not business_id:
        return
    row = _singleton(db)
    row.business_id = business_id
    db.commit()


def authorize_url(*, state: str) -> str:
    _require_config()
    from urllib.parse import quote, urlencode

    redirect_uri = settings.MYOB_REDIRECT_URI.strip()
    scopes = _normalize_scopes()
    q = {
        "client_id": settings.MYOB_APP_KEY or "",
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scopes,
        "state": state,
    }
    # MYOB expects query string; redirect_uri must be encoded in the final URL
    return f"{MYOB_AUTHORIZE_URL}?{urlencode(q, quote_via=quote)}"
