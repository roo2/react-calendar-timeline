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
MYOB_ACCOUNTRIGHT_BASE = "https://api.myob.com/accountright"

STATE_TTL = timedelta(minutes=10)
# Safety cap when following OData NextPageLink (GET-only pagination).
MYOB_CUSTOMER_FETCH_MAX_PAGES = 5000


def _as_utc_aware(dt: datetime) -> datetime:
    """SQLite often returns naive datetimes; normalize so comparisons with UTC `now` work."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


class MyobConfigError(RuntimeError):
    pass


class MyobOAuthError(RuntimeError):
    pass


class MyobApiError(RuntimeError):
    """Non-success response from the MYOB Business API (api.myob.com)."""


def effective_company_file_id(db: Session) -> tuple[str | None, str | None]:
    """
    Company file GUID for MYOB API paths. MYOB_COMPANY_FILE_ID env wins over DB (myob_connection.business_id).
    Returns (id, source) where source is 'config', 'database', or None if missing.
    """
    env_id = (settings.MYOB_COMPANY_FILE_ID or "").strip()
    if env_id:
        return env_id, "config"
    row = db.get(MyobConnection, 1)
    if row and row.business_id and str(row.business_id).strip():
        return str(row.business_id).strip(), "database"
    return None, None


def _myob_api_headers(*, access_token: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {access_token}",
        "x-myobapi-key": settings.MYOB_APP_KEY or "",
        "x-myobapi-version": "v2",
        "Accept": "application/json",
    }


def _access_token_usable(row: MyobConnection) -> bool:
    if not row.access_token:
        return False
    if row.access_token_expires_at is None:
        return True
    exp = _as_utc_aware(row.access_token_expires_at)
    return exp > datetime.now(UTC) + timedelta(seconds=90)


def ensure_myob_access_token_for_api(db: Session) -> str:
    """Refresh OAuth access token if needed. Does not change MYOB accounting data."""
    _require_config()
    row = _singleton(db)
    if not row.refresh_token:
        raise MyobConfigError("MYOB is not connected (no refresh token). Use Connect MYOB first.")
    cid, _src = effective_company_file_id(db)
    if not cid:
        raise MyobConfigError(
            "MYOB company file id is missing. Set MYOB_COMPANY_FILE_ID in the server environment, "
            "or save it on the MYOB admin page, or reconnect OAuth so MYOB returns businessId."
        )
    if _access_token_usable(row):
        return row.access_token or ""
    if not refresh_tokens(db, log_access_token=False):
        raise MyobOAuthError("Failed to refresh MYOB access token.")
    row = _singleton(db)
    if not row.access_token:
        raise MyobOAuthError("No access token after refresh.")
    return row.access_token


def _myob_get_json(*, url: str, access_token: str) -> dict[str, Any]:
    """
    GET-only helper for api.myob.com. Never use for mutating company data.
    """
    headers = _myob_api_headers(access_token=access_token)
    with httpx.Client(timeout=120.0) as client:
        resp = client.get(url, headers=headers)
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise MyobApiError(f"MYOB API error {resp.status_code}: {detail}")
    return resp.json()


def fetch_customers_readonly_preview(db: Session) -> dict[str, Any]:
    """
    Read-only: GET Contact/Customer from MYOB and return JSON-safe data for admin preview.

    Uses HTTP GET only against api.myob.com (no POST/PATCH/PUT/DELETE to the company file).
    OAuth token refresh uses secure.myob.com only and does not modify accounting records.
    """
    access = ensure_myob_access_token_for_api(db)
    business_id, _ = effective_company_file_id(db)
    business_id = (business_id or "").strip()
    first = (
        f"{MYOB_ACCOUNTRIGHT_BASE}/{business_id}/Contact/Customer"
        f"?$top=1000"
    )
    items: list[Any] = []
    url: str | None = first
    pages = 0
    truncated = False
    while url is not None:
        if pages >= MYOB_CUSTOMER_FETCH_MAX_PAGES:
            truncated = True
            break
        data = _myob_get_json(url=url, access_token=access)
        pages += 1
        batch = data.get("Items")
        if isinstance(batch, list):
            items.extend(batch)
        next_link = data.get("NextPageLink")
        url = next_link if isinstance(next_link, str) and next_link.strip() else None

    return {
        "business_id": business_id,
        "count": len(items),
        "pages_fetched": pages,
        "truncated": truncated,
        "items": items,
    }


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
    if _as_utc_aware(row.expires_at) < now:
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
    eff_id, eff_src = effective_company_file_id(db)
    row = db.get(MyobConnection, 1)
    if row is None or not row.refresh_token:
        return {
            "configured": myob_configured(),
            "connected": False,
            "business_id": eff_id,
            "business_id_source": eff_src,
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
        "business_id": eff_id,
        "business_id_source": eff_src,
        "access_token_expires_at": exp_at,
        "last_refreshed_at": ref_at,
        "scope": row.scope,
        "myob_username": row.myob_username,
    }


def set_business_id(db: Session, business_id: str | None) -> None:
    if not business_id:
        return
    row = _singleton(db)
    row.business_id = business_id.strip()
    db.commit()


def save_company_file_id(db: Session, *, business_id: str) -> None:
    """Persist MYOB AccountRight company file GUID (cf_uri segment) for API URLs."""
    cleaned = (business_id or "").strip()
    if not cleaned:
        raise MyobConfigError("business_id is empty.")
    row = _singleton(db)
    row.business_id = cleaned
    db.commit()


def disconnect_myob(db: Session) -> None:
    """Remove stored OAuth tokens and MYOB linkage (local DB only; does not call MYOB APIs)."""
    row = db.get(MyobConnection, 1)
    if row is None:
        return
    row.refresh_token = None
    row.access_token = None
    row.access_token_expires_at = None
    row.business_id = None
    row.scope = None
    row.myob_user_uid = None
    row.myob_username = None
    row.last_refreshed_at = None
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
