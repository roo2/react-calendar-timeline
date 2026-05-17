from __future__ import annotations

import re
import secrets
import sys
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.config import XERO_SCOPES, settings
from app.db.models.domain import Customer, XeroConnection, XeroOAuthState

XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"

STATE_TTL = timedelta(minutes=10)


def _as_utc_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


class XeroConfigError(RuntimeError):
    pass


class XeroOAuthError(RuntimeError):
    pass


class XeroApiError(RuntimeError):
    pass


def xero_configured() -> bool:
    return bool(settings.XERO_CLIENT_ID and settings.XERO_CLIENT_SECRET)


def _require_config() -> None:
    if not xero_configured():
        raise XeroConfigError("XERO_CLIENT_ID and XERO_CLIENT_SECRET must be set")


def _normalize_scopes() -> str:
    return " ".join(s for s in XERO_SCOPES.replace(",", " ").split() if s)


def cleanup_expired_oauth_states(db: Session) -> None:
    now = datetime.now(UTC)
    db.execute(delete(XeroOAuthState).where(XeroOAuthState.expires_at < now))


def create_oauth_state(db: Session) -> str:
    cleanup_expired_oauth_states(db)
    token = secrets.token_hex(32)
    now = datetime.now(UTC)
    db.add(XeroOAuthState(state=token, expires_at=now + STATE_TTL))
    db.commit()
    return token


def consume_oauth_state(db: Session, state: str | None) -> bool:
    if not state:
        return False
    cleanup_expired_oauth_states(db)
    row = db.get(XeroOAuthState, state)
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


def _singleton(db: Session) -> XeroConnection:
    row = db.get(XeroConnection, 1)
    if row is None:
        row = XeroConnection(id=1)
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
            XERO_TOKEN_URL,
            data=body,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise XeroOAuthError(f"Xero token endpoint error {resp.status_code}: {detail}")
    return resp.json()


def _apply_token_payload(db: Session, payload: dict[str, Any], *, log_access_token: bool = False) -> None:
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
    db.commit()
    if log_access_token and row.access_token:
        print(f"[XERO] access_token={row.access_token}", file=sys.stdout, flush=True)


def list_connections(*, access_token: str) -> list[dict[str, Any]]:
    with httpx.Client(timeout=60.0) as client:
        resp = client.get(
            XERO_CONNECTIONS_URL,
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise XeroApiError(f"Xero connections error {resp.status_code}: {detail}")
    data = resp.json()
    if not isinstance(data, list):
        raise XeroApiError("Xero connections response is not a JSON array.")
    return [c for c in data if isinstance(c, dict)]


def _pick_default_tenant_if_missing(db: Session, *, access_token: str) -> None:
    """After OAuth, select the first ORG tenant when none is stored."""
    row = _singleton(db)
    if (row.tenant_id or "").strip():
        return
    conns = list_connections(access_token=access_token)
    orgs = [c for c in conns if str(c.get("tenantType") or "").upper() == "ORGANISATION"]
    if not orgs:
        orgs = conns
    if not orgs:
        return
    first = orgs[0]
    tid = str(first.get("tenantId") or "").strip()
    tname = str(first.get("tenantName") or "").strip()
    if tid:
        row.tenant_id = tid
        row.tenant_name = tname or None
        db.commit()


def exchange_authorization_code(db: Session, *, code: str, redirect_uri: str) -> None:
    _require_config()
    data = {
        "grant_type": "authorization_code",
        "client_id": settings.XERO_CLIENT_ID or "",
        "client_secret": settings.XERO_CLIENT_SECRET or "",
        "code": code,
        "redirect_uri": redirect_uri,
    }
    payload = _post_token_form(data)
    _apply_token_payload(db, payload, log_access_token=True)
    row = _singleton(db)
    if not row.access_token:
        raise XeroOAuthError("No access token after authorization exchange.")
    _pick_default_tenant_if_missing(db, access_token=row.access_token)


def refresh_tokens(db: Session, *, log_access_token: bool = False) -> bool:
    _require_config()
    row = _singleton(db)
    if not row.refresh_token:
        return False
    data = {
        "grant_type": "refresh_token",
        "client_id": settings.XERO_CLIENT_ID or "",
        "client_secret": settings.XERO_CLIENT_SECRET or "",
        "refresh_token": row.refresh_token,
    }
    payload = _post_token_form(data)
    _apply_token_payload(db, payload, log_access_token=log_access_token)
    return True


def _access_token_usable(row: XeroConnection) -> bool:
    if not row.access_token:
        return False
    if row.access_token_expires_at is None:
        return True
    exp = _as_utc_aware(row.access_token_expires_at)
    return exp > datetime.now(UTC) + timedelta(seconds=90)


def _current_access_token(db: Session) -> str | None:
    """Return a usable access token, refreshing with the refresh token when expired."""
    row = _singleton(db)
    if not row.refresh_token:
        return None
    if _access_token_usable(row) and row.access_token:
        return row.access_token or ""
    if refresh_tokens(db, log_access_token=False):
        row = _singleton(db)
    return row.access_token or None


def ensure_xero_access_token_for_api(db: Session) -> str:
    _require_config()
    row = _singleton(db)
    if not row.refresh_token:
        raise XeroConfigError("Xero is not connected (no refresh token). Use Connect Xero in Admin first.")
    if not (row.tenant_id or "").strip():
        raise XeroConfigError("Xero tenant is not selected. Reconnect Xero or POST /api/xero/tenant with tenant_id.")
    tok = _current_access_token(db)
    if not tok:
        raise XeroOAuthError("No access token after refresh.")
    return tok


def connection_status(db: Session) -> dict[str, Any]:
    row = db.get(XeroConnection, 1)
    if row is None or not row.refresh_token:
        return {
            "configured": xero_configured(),
            "connected": False,
            "tenant_id": None,
            "tenant_name": None,
            "access_token_expires_at": None,
            "last_refreshed_at": None,
            "scope": None,
            "connections": [],
        }
    exp_at = row.access_token_expires_at.isoformat() if row.access_token_expires_at else None
    ref_at = row.last_refreshed_at.isoformat() if row.last_refreshed_at else None
    connections: list[dict[str, Any]] = []
    tok = _current_access_token(db)
    if tok:
        try:
            connections = list_connections(access_token=tok)
        except Exception:
            connections = []
    return {
        "configured": xero_configured(),
        "connected": True,
        "tenant_id": row.tenant_id,
        "tenant_name": row.tenant_name,
        "access_token_expires_at": exp_at,
        "last_refreshed_at": ref_at,
        "scope": row.scope,
        "connections": connections,
    }


def set_tenant_id(db: Session, *, tenant_id: str) -> None:
    tid = (tenant_id or "").strip()
    if not tid:
        raise XeroConfigError("tenant_id is empty.")
    row = _singleton(db)
    tok = _current_access_token(db)
    if not tok:
        raise XeroConfigError("Connect Xero before selecting a tenant (no access token).")
    orgs = list_connections(access_token=tok)
    match = next((c for c in orgs if str(c.get("tenantId") or "").strip() == tid), None)
    if not match:
        raise XeroConfigError("tenant_id is not in the authorised Xero connections list.")
    row.tenant_id = tid
    row.tenant_name = str(match.get("tenantName") or "").strip() or None
    db.commit()


def disconnect_xero(db: Session) -> None:
    row = db.get(XeroConnection, 1)
    if row is None:
        return
    row.refresh_token = None
    row.access_token = None
    row.access_token_expires_at = None
    row.tenant_id = None
    row.tenant_name = None
    row.scope = None
    row.last_refreshed_at = None
    db.commit()


def authorize_url(*, state: str) -> str:
    _require_config()
    redirect_uri = settings.XERO_REDIRECT_URI.strip()
    scopes = _normalize_scopes()
    q = {
        "response_type": "code",
        "client_id": settings.XERO_CLIENT_ID or "",
        "redirect_uri": redirect_uri,
        "scope": scopes,
        "state": state,
    }
    return f"{XERO_AUTHORIZE_URL}?{urlencode(q, quote_via=quote)}"


_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")


def _is_uuid(v: str) -> bool:
    return bool(_UUID_RE.match((v or "").strip()))


def create_draft_quote(
    db: Session,
    *,
    customer_id: str,
    title: str,
    line_description: str,
    quantity: float,
    unit_amount: float,
) -> dict[str, Any]:
    """
    Create a DRAFT quote in Xero for a linked customer (customers.xero_contact_id).

    Invoices can follow the same pattern later (POST /Invoices).
    """
    cust = db.get(Customer, customer_id)
    if not cust:
        raise XeroConfigError("Customer not found.")
    cid = (cust.xero_contact_id or "").strip()
    if not cid:
        raise XeroConfigError("Customer has no xero_contact_id. Set it on the customer record (Xero Contact UUID).")
    if not _is_uuid(cid):
        raise XeroConfigError("customers.xero_contact_id must be a Xero GUID (ContactID).")
    access = ensure_xero_access_token_for_api(db)
    row = _singleton(db)
    tenant = (row.tenant_id or "").strip()
    if not tenant:
        raise XeroConfigError("Xero tenant_id is missing.")

    today = date.today().isoformat()
    body: dict[str, Any] = {
        "Contact": {"ContactID": cid},
        "Date": today,
        "ExpiryDate": today,
        "Status": "DRAFT",
        "Title": (title or "").strip() or "Quote",
        "LineAmountTypes": "Exclusive",
        "LineItems": [
            {
                "Description": (line_description or "").strip() or "Line item",
                "Quantity": float(quantity),
                "UnitAmount": float(unit_amount),
            }
        ],
    }
    url = f"{XERO_API_BASE}/Quotes"
    headers = {
        "Authorization": f"Bearer {access}",
        "xero-tenant-id": tenant,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(url, headers=headers, json=body)
    if resp.status_code >= 400:
        try:
            detail = resp.json()
        except Exception:
            detail = resp.text
        raise XeroApiError(f"Xero Quotes API error {resp.status_code}: {detail}")
    try:
        payload = resp.json()
    except Exception as e:
        raise XeroApiError(f"Xero Quotes response is not JSON: {e}") from e
    return {"request_url": url, "xero": payload}
