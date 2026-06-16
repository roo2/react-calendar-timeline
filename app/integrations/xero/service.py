from __future__ import annotations

import re
import secrets
import sys
import time
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

import httpx
from sqlalchemy import delete, exists, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.config import XERO_SCOPES, settings
from app.customers.contact_address import normalize_contacts, parse_xero_updated_date_utc, phone_summaries
from app.customers.delivery_address import (
    customer_address_to_xero_addresses,
    customer_default_delivery_address_display,
    delivery_addresses_from_customer,
    format_address_display,
    pick_default_delivery_address,
)
from app.db.models.domain import (
    Customer,
    JobSheet,
    MyobIncomeAccount,
    MyobItemSellingUom,
    Order,
    OrderItem,
    Product,
    SavedQuote,
    XeroConnection,
    XeroOAuthState,
)
from app.db.models.rate_cards import Plate
from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID
from app.integrations.myob.customer_import import brand_id_for_code, ensure_default_customer_brands
from app.brands.service import brand_id_for_xero_branding_theme_id
from app.integrations.xero.customer_mapping import (
    customer_fields_from_xero_contact,
    customer_to_xero_contact_create_body,
    customer_to_xero_contact_update_body,
    merge_customer_fields_from_app_and_xero,
    pick_xero_branding_theme_id_from_list,
    xero_contact_branding_theme_id,
    xero_contact_match_detail,
)
from app.orders.product_line_display import product_code_for_version, product_display_name_for_line
from app.str_norm import strip_trailing_dash_suffix

XERO_AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize"
XERO_TOKEN_URL = "https://identity.xero.com/connect/token"
XERO_CONNECTIONS_URL = "https://api.xero.com/connections"
XERO_API_BASE = "https://api.xero.com/api.xro/2.0"

STATE_TTL = timedelta(minutes=10)
_XERO_HTTP_TIMEOUT_SECONDS = 120.0
_XERO_MAX_RATE_LIMIT_RETRIES = 3
_XERO_RATE_LIMIT_BASE_DELAY_SECONDS = 5.0
_XERO_RATE_LIMIT_MAX_PER_SLEEP_SECONDS = 12.0
# Heroku router times out HTTP requests at 30s; cap retry sleep so merge can finish in one request.
_XERO_RATE_LIMIT_MAX_TOTAL_SLEEP_SECONDS = 18.0
MERGE_ALL_SKIP_SYNCED_WITHIN = timedelta(hours=1)


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


def _apply_token_payload(
    db: Session, payload: dict[str, Any], *, log_access_token: bool = False
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
        raise XeroConfigError(
            "Xero is not connected (no refresh token). Use Connect Xero in Admin first."
        )
    if not (row.tenant_id or "").strip():
        raise XeroConfigError(
            "Xero tenant is not selected. Reconnect Xero or POST /api/xero/tenant with tenant_id."
        )
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


def _accounting_api_url(endpoint: str) -> str:
    raw = (endpoint or "").strip()
    if not raw:
        raise XeroConfigError("Xero endpoint is required.")

    parsed = urlsplit(raw)
    if parsed.scheme or parsed.netloc:
        raise XeroConfigError(
            "Enter a relative Xero Accounting API endpoint, for example /Contacts?page=1."
        )
    if parsed.fragment:
        raise XeroConfigError("Xero endpoint must not include a URL fragment.")

    path = parsed.path or ""
    if not path.startswith("/"):
        path = f"/{path}"
    if "//" in path:
        raise XeroConfigError("Xero endpoint path must not contain '//'.")

    return f"{XERO_API_BASE}{urlunsplit(('', '', path, parsed.query, ''))}"


def _xero_rate_limit_delay_seconds(resp: httpx.Response, attempt: int) -> float:
    retry_after = str(resp.headers.get("Retry-After") or "").strip()
    if retry_after:
        try:
            delay = max(float(retry_after), 1.0)
            return min(delay, _XERO_RATE_LIMIT_MAX_PER_SLEEP_SECONDS)
        except ValueError:
            pass
    return min(
        _XERO_RATE_LIMIT_BASE_DELAY_SECONDS * (attempt + 1),
        _XERO_RATE_LIMIT_MAX_PER_SLEEP_SECONDS,
    )


def _xero_http_response(
    *,
    method: str,
    url: str,
    headers: dict[str, str],
    json_body: dict[str, Any] | None = None,
) -> httpx.Response:
    total_slept = 0.0
    with httpx.Client(timeout=_XERO_HTTP_TIMEOUT_SECONDS) as client:
        for attempt in range(_XERO_MAX_RATE_LIMIT_RETRIES + 1):
            if method == "GET":
                resp = client.get(url, headers=headers)
            elif method == "POST":
                resp = client.post(url, headers=headers, json=json_body)
            elif method == "PUT":
                resp = client.put(url, headers=headers, json=json_body)
            else:
                raise ValueError(f"Unsupported Xero HTTP method: {method}")

            if resp.status_code != 429:
                return resp
            if attempt >= _XERO_MAX_RATE_LIMIT_RETRIES:
                return resp

            delay = _xero_rate_limit_delay_seconds(resp, attempt)
            if total_slept + delay > _XERO_RATE_LIMIT_MAX_TOTAL_SLEEP_SECONDS:
                return resp

            time.sleep(delay)
            total_slept += delay

    raise XeroApiError("Xero rate limit retries exhausted.")


def _xero_api_get_json(db: Session, *, endpoint: str) -> tuple[str, int, Any]:
    access = ensure_xero_access_token_for_api(db)
    row = _singleton(db)
    tenant = (row.tenant_id or "").strip()
    if not tenant:
        raise XeroConfigError("Xero tenant_id is missing.")

    url = _accounting_api_url(endpoint)
    headers = {
        "Authorization": f"Bearer {access}",
        "xero-tenant-id": tenant,
        "Accept": "application/json",
    }
    resp = _xero_http_response(method="GET", url=url, headers=headers)

    try:
        payload: Any = resp.json()
    except Exception:
        payload = resp.text

    if resp.status_code >= 400:
        raise XeroApiError(f"Xero GET error {resp.status_code}: {payload}")

    return url, resp.status_code, payload


def xero_get_endpoint(db: Session, *, endpoint: str) -> dict[str, Any]:
    """
    Call a relative Xero Accounting API GET endpoint using the stored tenant and OAuth token.

    This intentionally accepts only relative endpoints to avoid turning the admin utility into
    a general-purpose authenticated HTTP proxy.
    """
    url, status_code, payload = _xero_api_get_json(db, endpoint=endpoint)
    return {"request_url": url, "status_code": status_code, "xero": payload}


def _xero_api_post_json(
    db: Session,
    *,
    endpoint: str,
    body: dict[str, Any],
) -> tuple[str, int, Any]:
    access = ensure_xero_access_token_for_api(db)
    row = _singleton(db)
    tenant = (row.tenant_id or "").strip()
    if not tenant:
        raise XeroConfigError("Xero tenant_id is missing.")

    url = _accounting_api_url(endpoint)
    headers = {
        "Authorization": f"Bearer {access}",
        "xero-tenant-id": tenant,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    resp = _xero_http_response(method="POST", url=url, headers=headers, json_body=body)

    try:
        payload: Any = resp.json()
    except Exception:
        payload = resp.text

    if resp.status_code >= 400:
        raise XeroApiError(f"Xero POST error {resp.status_code}: {payload}")

    return url, resp.status_code, payload


def _xero_api_put_json(
    db: Session,
    *,
    endpoint: str,
    body: dict[str, Any],
) -> tuple[str, int, Any]:
    access = ensure_xero_access_token_for_api(db)
    row = _singleton(db)
    tenant = (row.tenant_id or "").strip()
    if not tenant:
        raise XeroConfigError("Xero tenant_id is missing.")

    url = _accounting_api_url(endpoint)
    headers = {
        "Authorization": f"Bearer {access}",
        "xero-tenant-id": tenant,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    resp = _xero_http_response(method="PUT", url=url, headers=headers, json_body=body)

    try:
        payload: Any = resp.json()
    except Exception:
        payload = resp.text

    if resp.status_code >= 400:
        raise XeroApiError(f"Xero PUT error {resp.status_code}: {payload}")

    return url, resp.status_code, payload


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out != out:
        return None
    return out


def _positive_float(value: Any) -> float | None:
    out = _as_float(value)
    return out if out is not None and out > 0 else None


def _line_gst_rate(oi: OrderItem, fallback: float) -> float:
    tax_code = str(getattr(oi, "tax_code", None) or "").strip().upper()
    if tax_code in {"N-T", "NT", "FRE", "FREE", "GST FREE", "EXP", "ITS"}:
        return 0.0
    rate = _as_float(getattr(oi, "gst_rate", None))
    return max(0.0, rate if rate is not None else fallback)


def _xero_tax_type_for_gst_rate(rate: float) -> str:
    return "OUTPUT" if float(rate or 0) > 0 else "EXEMPTOUTPUT"


def _myob_income_display_for_order_item(db: Session, oi: OrderItem) -> str | None:
    raw = getattr(oi, "myob_item_json", None)
    if isinstance(raw, dict):
        dolphin = raw.get("_dolphin")
        if isinstance(dolphin, dict):
            account_id = str(dolphin.get("income_account_id") or "").strip()
            if account_id:
                account = db.get(MyobIncomeAccount, account_id)
                if account is not None and account.display_id:
                    return str(account.display_id).strip() or None
        inc = raw.get("IncomeAccount")
        if isinstance(inc, dict):
            uid = str(inc.get("UID") or "").strip()
            if uid:
                account = db.get(MyobIncomeAccount, uid)
                if account is None:
                    account = db.scalar(
                        select(MyobIncomeAccount).where(MyobIncomeAccount.myob_account_uid == uid)
                    )
                if account is not None and account.display_id:
                    return str(account.display_id).strip() or None

    item_uid = str(getattr(oi, "myob_item_uid", None) or "").strip()
    if item_uid:
        row = db.get(MyobItemSellingUom, item_uid)
        account_uid = (
            str(getattr(row, "myob_income_account_uid", None) or "").strip()
            if row is not None
            else ""
        )
        if account_uid:
            account = db.get(MyobIncomeAccount, account_uid)
            if account is not None and account.display_id:
                return str(account.display_id).strip() or None
    return None


def _manufactured_income_account_code(db: Session, oi: OrderItem) -> str | None:
    code = _myob_income_display_for_order_item(db, oi)
    if code:
        return code
    # Same default as app.orders.routes for in-house manufactured products.
    account = db.get(MyobIncomeAccount, "3d453a97-a7e0-4c7f-a0be-fd89ba3f6a46")
    if account is not None and account.display_id:
        return str(account.display_id).strip() or None
    return None


def _order_item_description(oi: OrderItem, order_import_source: str | None) -> str:
    del order_import_source
    kind = str(getattr(oi, "line_kind", None) or "manufactured")
    if kind == "resell":
        raw = (
            str(getattr(oi, "import_line_description", None) or "").strip()
            or str(getattr(oi, "resell_description_snapshot", None) or "").strip()
        )
        return strip_trailing_dash_suffix(raw) or "Resell line"
    if kind == "myob_import":
        return (
            str(getattr(oi, "import_line_description", None) or "").strip()
            or str(getattr(oi, "myob_item_name", None) or "").strip()
            or "Imported line"
        )

    js = getattr(oi, "job_sheet", None)
    product = getattr(js, "product", None) if js is not None else None
    version = getattr(js, "version", None) if js is not None else None
    if product is not None:
        code = product_code_for_version(product, version)
        name = product_display_name_for_line(
            p=product,
            pv=version,
            js=js,
            import_line_description=getattr(oi, "import_line_description", None),
        )
        if code and name:
            return f"{code} - {name}"
        return code or name or "Manufactured line"
    return "Manufactured line"


def _order_item_quantity_rate_total(oi: OrderItem) -> tuple[float, float | None, float | None]:
    kind = str(getattr(oi, "line_kind", None) or "manufactured")
    if kind == "resell":
        return (
            _positive_float(getattr(oi, "resell_quantity_value", None)) or 1.0,
            _as_float(getattr(oi, "resell_unit_rate", None)),
            _as_float(getattr(oi, "resell_line_total", None)),
        )
    if kind == "myob_import":
        js = getattr(oi, "job_sheet", None)
        qty = _positive_float(getattr(js, "quantity_value", None) if js is not None else None)
        rate = _as_float(getattr(js, "unit_rate", None) if js is not None else None)
        total = _as_float(getattr(js, "line_total", None) if js is not None else None)
        if qty is None:
            qty = _positive_float(getattr(oi, "import_ship_quantity", None))
        if rate is None:
            rate = _as_float(getattr(oi, "import_unit_price", None))
        if total is None:
            total = _as_float(getattr(oi, "import_line_total", None))
        return (qty or 1.0, rate, total)

    js = getattr(oi, "job_sheet", None)
    return (
        _positive_float(getattr(js, "quantity_value", None) if js is not None else None) or 1.0,
        _as_float(getattr(js, "unit_rate", None) if js is not None else None),
        _as_float(getattr(js, "line_total", None) if js is not None else None),
    )


def _order_item_account_code(db: Session, oi: OrderItem) -> str | None:
    kind = str(getattr(oi, "line_kind", None) or "manufactured")
    if kind == "resell":
        rp = getattr(oi, "resell_product", None)
        account_uid = str(getattr(rp, "myob_income_account_uid", None) or "").strip()
        if account_uid:
            account = db.get(MyobIncomeAccount, account_uid)
            if account is not None and account.display_id:
                return str(account.display_id).strip() or None
        return _myob_income_display_for_order_item(db, oi)
    return _manufactured_income_account_code(db, oi)


def _load_order_for_xero_invoice(db: Session, order_id: str) -> Order:
    order = db.scalars(
        select(Order)
        .where(Order.id == str(order_id))
        .options(joinedload(Order.customer).joinedload(Customer.brand))
        .options(joinedload(Order.items).joinedload(OrderItem.job_sheet).joinedload(JobSheet.product))
        .options(joinedload(Order.items).joinedload(OrderItem.job_sheet).joinedload(JobSheet.version))
        .options(joinedload(Order.items).joinedload(OrderItem.resell_product))
    ).unique().one_or_none()
    if order is None:
        raise XeroConfigError("Order not found.")
    return order


def _sync_xero_contact_delivery_address(
    db: Session,
    *,
    contact_id: str,
    delivery_address: dict[str, Any] | None,
) -> None:
    """Push the app customer's default delivery address onto the linked Xero contact."""
    xero_addresses = customer_address_to_xero_addresses(delivery_address or {})
    if not xero_addresses:
        return
    _xero_api_post_json(
        db,
        endpoint="/Contacts",
        body={"Contacts": [{"ContactID": contact_id, "Addresses": xero_addresses}]},
    )


def _resolve_xero_branding_theme_id(
    db: Session,
    *,
    brand_code: str | None,
    brand_name: str | None,
    stored_xero_branding_theme_id: str | None = None,
) -> str | None:
    """Resolve Xero BrandingThemeID for an app brand (stored mapping first, then name match)."""
    stored = str(stored_xero_branding_theme_id or "").strip()
    if stored:
        return stored

    _, _, payload = _xero_api_get_json(db, endpoint="/BrandingThemes")
    rows = payload.get("BrandingThemes") if isinstance(payload, dict) else None
    return pick_xero_branding_theme_id_from_list(
        rows,
        brand_code=brand_code,
        brand_name=brand_name,
    )


def _xero_branding_theme_id_for_brand(db: Session, brand: Any | None) -> str | None:
    if brand is None:
        return None
    return _resolve_xero_branding_theme_id(
        db,
        brand_code=getattr(brand, "code", None),
        brand_name=getattr(brand, "name", None),
        stored_xero_branding_theme_id=getattr(brand, "xero_branding_theme_id", None),
    )


def _extract_xero_invoice(payload: Any) -> dict[str, Any]:
    rows = payload.get("Invoices") if isinstance(payload, dict) else None
    if isinstance(rows, list) and rows and isinstance(rows[0], dict):
        return rows[0]
    if isinstance(payload, dict) and isinstance(payload.get("Invoice"), dict):
        return payload["Invoice"]
    return {}


def export_order_to_xero_invoice(db: Session, *, order_id: str) -> dict[str, Any]:
    """
    Create a DRAFT ACCREC invoice in Xero from a current local order.

    The order's customer must already be linked via customers.xero_contact_id. We store the
    returned Xero InvoiceID on the order to avoid accidental duplicate exports.
    """
    order = _load_order_for_xero_invoice(db, order_id)
    existing_invoice_id = str(getattr(order, "xero_invoice_id", "") or "").strip()
    if existing_invoice_id:
        return {
            "ok": True,
            "already_exported": True,
            "order_id": str(order.id),
            "xero_invoice_id": existing_invoice_id,
            "xero_invoice_number": getattr(order, "xero_invoice_number", None),
        }

    customer = getattr(order, "customer", None)
    contact_id = str(getattr(customer, "xero_contact_id", "") or "").strip()
    if not contact_id:
        raise XeroConfigError(
            "Order customer has no xero_contact_id. Link this customer to Xero before exporting."
        )
    if not _is_uuid(contact_id):
        raise XeroConfigError("customers.xero_contact_id must be a Xero GUID (ContactID).")

    order_gst_rate = _as_float(getattr(order, "gst_rate", None)) or 0.10
    line_items: list[dict[str, Any]] = []
    missing: list[str] = []
    for oi in sorted(getattr(order, "items", None) or [], key=lambda x: (x.line_index, str(x.id))):
        if str(getattr(oi, "line_kind", None) or "manufactured") == "myob_import" and bool(
            getattr(oi, "import_requires_job_sheet", False)
        ):
            js = getattr(oi, "job_sheet", None)
            if js is not None and bool(getattr(js, "is_import_draft", False)):
                missing.append(f"line {oi.line_index + 1}: job sheet is still an import draft")
                continue

        qty, rate, total = _order_item_quantity_rate_total(oi)
        if total is None and rate is None:
            missing.append(f"line {oi.line_index + 1}: missing price")
            continue
        unit_amount = float(total) / qty if total is not None else float(rate or 0.0)
        account_code = _order_item_account_code(db, oi)
        if not account_code:
            missing.append(f"line {oi.line_index + 1}: missing Xero account code")
            continue
        line_items.append(
            {
                "Description": _order_item_description(oi, getattr(order, "import_source", None)),
                "Quantity": float(qty),
                "UnitAmount": round(float(unit_amount), 6),
                "AccountCode": account_code,
                "TaxType": _xero_tax_type_for_gst_rate(_line_gst_rate(oi, order_gst_rate)),
            }
        )

    if missing:
        raise XeroConfigError("Cannot export order to Xero invoice: " + "; ".join(missing))
    if not line_items:
        raise XeroConfigError("Cannot export an order with no invoiceable lines.")

    delivery_address = pick_default_delivery_address(delivery_addresses_from_customer(customer))
    try:
        _sync_xero_contact_delivery_address(
            db,
            contact_id=contact_id,
            delivery_address=delivery_address,
        )
    except XeroApiError as e:
        raise XeroConfigError(f"Could not update Xero contact delivery address: {e}") from e

    brand = getattr(customer, "brand", None)
    branding_theme_id = _xero_branding_theme_id_for_brand(db, brand)

    invoice_date = getattr(order, "order_date", None) or date.today()
    invoice_number = str(getattr(order, "code", "") or "").strip()
    invoice_date_str = (
        invoice_date.isoformat() if hasattr(invoice_date, "isoformat") else str(invoice_date)
    )
    body: dict[str, Any] = {
        "Type": "ACCREC",
        "Contact": {"ContactID": contact_id},
        "Date": invoice_date_str,
        "DueDate": invoice_date_str,
        "Status": "DRAFT",
        "LineAmountTypes": "Exclusive",
        "LineItems": line_items,
    }
    if invoice_number:
        body["InvoiceNumber"] = invoice_number
    reference = str(getattr(order, "customer_purchase_order_number", "") or "").strip()
    if reference:
        body["Reference"] = reference
    if branding_theme_id:
        body["BrandingThemeID"] = branding_theme_id

    url, status_code, payload = _xero_api_post_json(
        db,
        endpoint="/Invoices",
        body={"Invoices": [body]},
    )
    invoice = _extract_xero_invoice(payload)
    invoice_id = str(invoice.get("InvoiceID") or invoice.get("InvoiceId") or "").strip()
    if not invoice_id:
        raise XeroApiError(f"Xero Invoices response did not include an InvoiceID: {payload}")

    order.xero_invoice_id = invoice_id
    order.xero_invoice_number = (
        str(invoice.get("InvoiceNumber") or invoice_number or "").strip() or None
    )
    order.xero_invoice_exported_at = datetime.now(UTC)
    db.add(order)
    db.commit()

    return {
        "ok": True,
        "already_exported": False,
        "order_id": str(order.id),
        "request_url": url,
        "status_code": status_code,
        "xero_invoice_id": invoice_id,
        "xero_invoice_number": order.xero_invoice_number,
        "xero": payload,
    }


# Legacy imported app customers were stored with names trimmed to ~25 characters.
IMPORTED_CUSTOMER_NAME_MAX_LEN = 25
# Allow a small overrun (e.g. word-boundary trims) when matching truncated app names to full Xero names.
TRUNCATED_APP_NAME_MAX_LEN = 30
TRUNCATED_APP_NAME_MIN_LEN = 12


def _normalize_match_text(value: Any) -> str:
    s = str(value or "").casefold()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _legacy_truncated_app_name_norm(value: Any) -> str:
    """
    Normalized app customer name when it may be a legacy truncated import (MYOB/Dolphin ~25 chars).

    Used to match full Xero contact names that start with the stored app name.
    """
    raw = str(value or "").strip()
    if not raw or len(raw) > TRUNCATED_APP_NAME_MAX_LEN:
        return ""
    norm = _normalize_match_text(raw)
    if len(norm) < TRUNCATED_APP_NAME_MIN_LEN:
        return ""
    return norm


def _imported_customer_name_key(value: Any) -> str:
    """Normalized key for app customers whose stored name is at most 25 characters."""
    return _legacy_truncated_app_name_norm(value) if len(str(value or "").strip()) <= IMPORTED_CUSTOMER_NAME_MAX_LEN else ""


def _xero_imported_name_lookup_key(value: Any) -> str:
    """Compare Xero's full name using the same 25-character prefix used on import."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    return _normalize_match_text(raw[:IMPORTED_CUSTOMER_NAME_MAX_LEN])


def _unique_truncated_name_prefix_match(
    customers: list[Customer],
    xero_name: str,
    *,
    truncated_candidates: list[tuple[Customer, str]] | None = None,
) -> Customer | None:
    """
    Match a Xero contact name to a unique app customer whose stored name is a truncated prefix.

    E.g. app ``HINTERLAND COMMERCIAL LAUN`` (26 chars) ↔ Xero ``HINTERLAND COMMERCIAL LAUNDRY``.
    """
    xero_norm = _normalize_match_text(xero_name)
    if not xero_norm:
        return None
    candidates = truncated_candidates
    if candidates is None:
        candidates = [
            (cust, norm)
            for cust in customers
            if (norm := _legacy_truncated_app_name_norm(cust.name))
        ]
    matches: list[Customer] = []
    for cust, app_norm in candidates:
        if xero_norm == app_norm or (len(xero_norm) > len(app_norm) and xero_norm.startswith(app_norm)):
            matches.append(cust)
    if len(matches) == 1:
        return matches[0]
    return None


def _normalize_account_code(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value or "").casefold())


def _normalize_tax_number(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or ""))


def _first_present(*values: Any) -> str:
    for value in values:
        s = str(value or "").strip()
        if s:
            return s
    return ""


def _xero_contact_account_code(raw: dict[str, Any]) -> str:
    return _first_present(
        raw.get("AccountNumber"),
        raw.get("ContactNumber"),
        raw.get("ContactCode"),
    )


def _xero_contact_id(raw: dict[str, Any]) -> str:
    return str(raw.get("ContactID") or raw.get("ContactId") or "").strip()


def _load_xero_contacts_for_customer_linking(
    db: Session, *, max_pages: int = 50
) -> list[dict[str, Any]]:
    contacts: list[dict[str, Any]] = []
    for page in range(1, max(1, int(max_pages)) + 1):
        _, _, payload = _xero_api_get_json(db, endpoint=f"/Contacts?page={page}")
        rows = payload.get("Contacts") if isinstance(payload, dict) else None
        if not isinstance(rows, list) or not rows:
            break
        contacts.extend([r for r in rows if isinstance(r, dict)])
        if len(rows) < 100:
            break
    return contacts


def _unique_index(rows: list[Customer], key_fn) -> dict[str, Customer]:
    buckets: dict[str, list[Customer]] = {}
    for row in rows:
        key = key_fn(row)
        if key:
            buckets.setdefault(key, []).append(row)
    return {key: matches[0] for key, matches in buckets.items() if len(matches) == 1}


def _deletable_unlinked_customers_select():
    """Customer ids with no Xero link and no blocking related records."""
    draft_id = str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID)
    return (
        select(Customer.id)
        .where(
            Customer.id != draft_id,
            Customer.xero_contact_id.is_(None),
            ~exists(select(1).where(Order.customer_id == Customer.id)),
            ~exists(select(1).where(SavedQuote.customer_id == Customer.id)),
            ~exists(select(1).where(Product.customer_id == Customer.id)),
            ~exists(select(1).where(JobSheet.customer_id == Customer.id)),
            ~exists(select(1).where(Plate.customer_id == Customer.id)),
        )
    )


def _customer_counts(db: Session) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    pairs = (
        (Order, "orders_count"),
        (SavedQuote, "quotes_count"),
        (Product, "products_count"),
        (JobSheet, "job_sheets_count"),
        (Plate, "plates_count"),
    )
    for model, key in pairs:
        count_expr = func.count(Plate.plate_code) if model is Plate else func.count(model.id)
        rows = db.execute(
            select(model.customer_id, count_expr).group_by(model.customer_id)
        ).all()
        for customer_id, count in rows:
            out.setdefault(str(customer_id), {})[key] = int(count or 0)
    return out


def _customer_review_row(cust: Customer, counts: dict[str, dict[str, int]]) -> dict[str, Any]:
    c = counts.get(str(cust.id), {})
    return {
        "id": str(cust.id),
        "name": cust.name,
        "status": cust.status,
        "myob_customer_uid": getattr(cust, "myob_customer_uid", None),
        "myob_display_id": getattr(cust, "myob_display_id", None),
        "xero_contact_id": getattr(cust, "xero_contact_id", None),
        "orders_count": int(c.get("orders_count", 0)),
        "quotes_count": int(c.get("quotes_count", 0)),
        "products_count": int(c.get("products_count", 0)),
        "job_sheets_count": int(c.get("job_sheets_count", 0)),
        "plates_count": int(c.get("plates_count", 0)),
    }


def _customer_deletable_reason(row: dict[str, Any]) -> str | None:
    """Return a blocking reason when an unlinked customer cannot be deleted."""
    if int(row.get("orders_count", 0)) > 0:
        return "has_orders"
    if int(row.get("quotes_count", 0)) > 0:
        return "has_quotes"
    if int(row.get("products_count", 0)) > 0:
        return "has_products"
    if int(row.get("job_sheets_count", 0)) > 0:
        return "has_job_sheets"
    if int(row.get("plates_count", 0)) > 0:
        return "has_plates"
    return None


def _xero_address_has_content(addr: dict[str, Any]) -> bool:
    return any(
        str(addr.get(k) or "").strip()
        for k in (
            "AddressLine1",
            "AddressLine2",
            "AddressLine3",
            "AddressLine4",
            "City",
            "Region",
            "PostalCode",
            "Country",
        )
    )


def _format_xero_address_display(addr: dict[str, Any]) -> str | None:
    lines: list[str] = []
    for key in ("AddressLine1", "AddressLine2", "AddressLine3", "AddressLine4"):
        value = str(addr.get(key) or "").strip()
        if value:
            lines.append(value)
    locality = " ".join(
        p
        for p in (
            str(addr.get("City") or "").strip(),
            str(addr.get("Region") or "").strip(),
            str(addr.get("PostalCode") or "").strip(),
        )
        if p
    )
    if locality:
        lines.append(locality)
    country = str(addr.get("Country") or "").strip()
    if country:
        lines.append(country)
    return "\n".join(lines) if lines else None


def _xero_primary_address_display(raw: dict[str, Any]) -> str | None:
    addrs = raw.get("Addresses")
    if not isinstance(addrs, list):
        return None
    by_type: dict[str, dict[str, Any]] = {}
    for row in addrs:
        if not isinstance(row, dict):
            continue
        addr_type = str(row.get("AddressType") or "").strip().upper()
        if addr_type:
            by_type[addr_type] = row
    for addr_type in ("STREET", "POBOX", "DELIVERY"):
        addr = by_type.get(addr_type)
        if addr and _xero_address_has_content(addr):
            return _format_xero_address_display(addr)
    for row in addrs:
        if isinstance(row, dict) and _xero_address_has_content(row):
            return _format_xero_address_display(row)
    return None


def _xero_contact_summary(raw: dict[str, Any]) -> dict[str, Any]:
    contact_id = _xero_contact_id(raw)
    return {
        "contact_id": contact_id,
        "name": str(raw.get("Name") or "").strip(),
        "account_code": _xero_contact_account_code(raw),
        "tax_number": str(raw.get("TaxNumber") or "").strip() or None,
        "primary_address": _xero_primary_address_display(raw),
    }


def search_xero_contacts(
    db: Session,
    *,
    query: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search Xero contacts for manual customer linking."""
    q = str(query or "").strip()
    cap = max(1, min(int(limit), 100))
    if q:
        safe = q.replace('"', '\\"')
        where = f'Name.Contains("{safe}")'
        endpoint = f"/Contacts?where={quote(where)}&page=1"
    else:
        endpoint = "/Contacts?page=1"
    _, _, payload = _xero_api_get_json(db, endpoint=endpoint)
    rows = payload.get("Contacts") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    out: list[dict[str, Any]] = []
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        summary = _xero_contact_summary(raw)
        if summary["contact_id"]:
            out.append(summary)
        if len(out) >= cap:
            break
    return out


def _orders_count_by_customer_ids(db: Session, customer_ids: list[str]) -> dict[str, int]:
    if not customer_ids:
        return {}
    rows = db.execute(
        select(Order.customer_id, func.count(Order.id))
        .where(Order.customer_id.in_(customer_ids))
        .group_by(Order.customer_id)
    ).all()
    return {str(customer_id): int(count or 0) for customer_id, count in rows}


def search_app_customers_for_xero_link(
    db: Session,
    *,
    query: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search unlinked app customers for manual Xero linking."""
    q = str(query or "").strip()
    cap = max(1, min(int(limit), 100))
    stmt = (
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(
            Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
            Customer.xero_contact_id.is_(None),
        )
        .order_by(Customer.name.asc())
        .limit(cap)
    )
    if q:
        stmt = stmt.where(Customer.name.ilike(f"%{q}%"))
    rows = list(db.scalars(stmt).all())
    orders_by_id = _orders_count_by_customer_ids(db, [str(c.id) for c in rows])
    return [
        _app_customer_match_detail(cust, orders_count=orders_by_id.get(str(cust.id), 0))
        for cust in rows
    ]


def manual_link_xero_customer(db: Session, *, customer_id: str, contact_id: str) -> dict[str, Any]:
    """Link one app customer to a Xero contact (writes customers.xero_contact_id only)."""
    cid = str(customer_id or "").strip()
    xid = str(contact_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if not _is_uuid(xid):
        raise XeroConfigError("contact_id must be a Xero GUID (ContactID).")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot link the internal MYOB draft customer.")

    cust = db.get(Customer, cid)
    if cust is None:
        raise XeroConfigError("Customer not found.")

    existing_xero = str(getattr(cust, "xero_contact_id", "") or "").strip()
    if existing_xero == xid:
        return {
            "ok": True,
            "already_linked": True,
            "customer_id": cid,
            "contact_id": xid,
            "customer_name": cust.name,
        }
    if existing_xero and existing_xero != xid:
        raise XeroConfigError(
            "Customer is already linked to a different Xero contact. Clear or change it on the customer record first."
        )

    other = db.scalar(
        select(Customer).where(Customer.xero_contact_id == xid, Customer.id != cid)
    )
    if other is not None:
        raise XeroConfigError(f"That Xero contact is already linked to customer: {other.name}")

    _, _, payload = _xero_api_get_json(db, endpoint=f"/Contacts/{xid}")
    contacts = payload.get("Contacts") if isinstance(payload, dict) else None
    contact_raw = contacts[0] if isinstance(contacts, list) and contacts else None
    if not isinstance(contact_raw, dict):
        raise XeroConfigError("Xero contact not found.")

    contact = _xero_contact_summary(contact_raw)
    try:
        with db.begin_nested():
            cust.xero_contact_id = xid
            db.add(cust)
            db.flush()
    except IntegrityError:
        raise XeroConfigError("That Xero contact is already linked to another customer.") from None
    db.commit()

    return {
        "ok": True,
        "already_linked": False,
        "customer_id": cid,
        "contact_id": xid,
        "customer_name": cust.name,
        "xero_name": contact["name"],
        "xero_account_code": contact.get("account_code"),
    }


def _app_contact_person_names(contacts_raw: Any) -> list[str]:
    names: list[str] = []
    for item in normalize_contacts(contacts_raw)["items"]:
        first = str(item.get("first_name") or "").strip()
        last = str(item.get("last_name") or "").strip()
        name = " ".join(part for part in (first, last) if part)
        if name:
            names.append(name)
    return names


def _app_delivery_address_summaries(customer: Customer) -> list[dict[str, str]]:
    summaries: list[dict[str, str]] = []
    for addr in delivery_addresses_from_customer(customer):
        display = format_address_display(addr)
        if not display:
            continue
        addr_type = str(addr.get("address_type") or "STREET").strip().upper()
        summaries.append({"address_type": addr_type, "display": display})
    return summaries


def _app_customer_match_detail(customer: Customer, *, orders_count: int = 0) -> dict[str, Any]:
    brand = getattr(customer, "brand", None)
    return {
        "id": str(customer.id),
        "name": customer.name,
        "myob_display_id": getattr(customer, "myob_display_id", None),
        "abn": getattr(customer, "abn", None),
        "brand_name": getattr(brand, "name", None) if brand else None,
        "brand_code": getattr(brand, "code", None) if brand else None,
        "branding_theme_id": getattr(brand, "xero_branding_theme_id", None) if brand else None,
        "contact_first_name": getattr(customer, "contact_first_name", None),
        "contact_last_name": getattr(customer, "contact_last_name", None),
        "email_address": getattr(customer, "email_address", None),
        "contact_phone": getattr(customer, "contact_phone", None),
        "phones": phone_summaries(
            getattr(customer, "phones", None),
            contact_phone=getattr(customer, "contact_phone", None),
        ),
        "status": getattr(customer, "status", None),
        "notes": getattr(customer, "notes", None),
        "contact_persons": _app_contact_person_names(getattr(customer, "contacts", None)),
        "addresses": _app_delivery_address_summaries(customer),
        "xero_contact_id": str(getattr(customer, "xero_contact_id", "") or "").strip() or None,
        "xero_last_modified": (
            customer.xero_last_modified.isoformat()
            if getattr(customer, "xero_last_modified", None) is not None
            else None
        ),
        "xero_synced_at": (
            customer.xero_synced_at.isoformat()
            if getattr(customer, "xero_synced_at", None) is not None
            else None
        ),
        "orders_count": orders_count,
    }


def compare_xero_app_customer_match(
    db: Session,
    *,
    customer_id: str,
    contact_id: str | None = None,
) -> dict[str, Any]:
    """Side-by-side app vs Xero contact details for link/sync decisions."""
    cid = str(customer_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot compare the internal MYOB draft customer.")

    cust = db.scalar(
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(Customer.id == cid)
    )
    if cust is None:
        raise XeroConfigError("Customer not found.")

    orders_count = _orders_count_by_customer_ids(db, [cid]).get(cid, 0)
    app_detail = _app_customer_match_detail(cust, orders_count=orders_count)

    xid = str(contact_id or getattr(cust, "xero_contact_id", "") or "").strip()
    xero_detail: dict[str, Any] | None = None
    if xid:
        if not _is_uuid(xid):
            raise XeroConfigError("contact_id must be a Xero GUID (ContactID).")
        _, _, payload = _xero_api_get_json(db, endpoint=f"/Contacts/{xid}")
        contacts = payload.get("Contacts") if isinstance(payload, dict) else None
        contact_raw = contacts[0] if isinstance(contacts, list) and contacts else None
        if not isinstance(contact_raw, dict):
            raise XeroConfigError("Xero contact not found.")
        xero_detail = xero_contact_match_detail(contact_raw)

    return {
        "customer_id": cid,
        "contact_id": xid or None,
        "app": app_detail,
        "xero": xero_detail,
    }


def search_app_customers_for_xero_sync(
    db: Session,
    *,
    query: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Search app customers already linked to Xero for manual sync-from-Xero."""
    q = str(query or "").strip()
    cap = max(1, min(int(limit), 100))
    stmt = (
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(
            Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
            Customer.xero_contact_id.isnot(None),
        )
        .order_by(Customer.name.asc())
        .limit(cap)
    )
    if q:
        stmt = stmt.where(Customer.name.ilike(f"%{q}%"))
    rows = list(db.scalars(stmt).all())
    orders_by_id = _orders_count_by_customer_ids(db, [str(c.id) for c in rows])
    return [
        _app_customer_match_detail(cust, orders_count=orders_by_id.get(str(cust.id), 0))
        for cust in rows
    ]


def _extract_xero_contact_from_post_response(payload: Any) -> dict[str, Any]:
    rows = payload.get("Contacts") if isinstance(payload, dict) else None
    contact_raw = rows[0] if isinstance(rows, list) and rows else None
    if not isinstance(contact_raw, dict):
        raise XeroApiError(f"Xero Contacts response did not include a contact: {payload}")
    if contact_raw.get("HasValidationErrors"):
        errors = contact_raw.get("ValidationErrors")
        if isinstance(errors, list) and errors:
            detail = "; ".join(
                str(e.get("Message") or e) if isinstance(e, dict) else str(e) for e in errors
            )
            raise XeroApiError(f"Xero contact validation failed: {detail}")
        raise XeroApiError("Xero contact validation failed.")
    return contact_raw


def create_xero_contact_for_customer(db: Session, *, customer_id: str) -> dict[str, Any]:
    """Create a new Xero contact from app customer fields and link customers.xero_contact_id."""
    cid = str(customer_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot create a Xero contact for the internal MYOB draft customer.")

    cust = db.scalar(
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(Customer.id == cid)
    )
    if cust is None:
        raise XeroConfigError("Customer not found.")

    existing_xero = str(getattr(cust, "xero_contact_id", "") or "").strip()
    if existing_xero:
        raise XeroConfigError("Customer is already linked to a Xero contact.")

    try:
        contact_body = customer_to_xero_contact_create_body(
            name=cust.name,
            abn=getattr(cust, "abn", None),
            contact_first_name=getattr(cust, "contact_first_name", None),
            contact_last_name=getattr(cust, "contact_last_name", None),
            email_address=getattr(cust, "email_address", None),
            contact_phone=getattr(cust, "contact_phone", None),
            phones=getattr(cust, "phones", None),
            status=getattr(cust, "status", None),
            contacts=getattr(cust, "contacts", None),
            delivery_addresses=getattr(cust, "delivery_addresses", None),
        )
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    _, _, payload = _xero_api_post_json(
        db,
        endpoint="/Contacts",
        body={"Contacts": [contact_body]},
    )
    contact_raw = _extract_xero_contact_from_post_response(payload)
    contact_id = _xero_contact_id(contact_raw)
    if not contact_id or not _is_uuid(contact_id):
        raise XeroApiError("Xero did not return a valid ContactID.")

    other = db.scalar(
        select(Customer).where(Customer.xero_contact_id == contact_id, Customer.id != cid)
    )
    if other is not None:
        raise XeroConfigError(
            f"Xero returned a contact already linked to customer: {other.name}"
        )

    try:
        with db.begin_nested():
            cust.xero_contact_id = contact_id
            cust.xero_last_modified = parse_xero_updated_date_utc(contact_raw.get("UpdatedDateUTC"))
            cust.xero_synced_at = datetime.now(UTC)
            db.add(cust)
            db.flush()
    except IntegrityError:
        raise XeroConfigError("That Xero contact is already linked to another customer.") from None
    db.commit()

    summary = _xero_contact_summary(contact_raw)
    contacts_items = contact_body.get("ContactPersons")
    address_items = contact_body.get("Addresses")
    return {
        "ok": True,
        "created": True,
        "customer_id": cid,
        "contact_id": contact_id,
        "customer_name": cust.name,
        "xero_name": summary.get("name") or cust.name,
        "xero_account_code": summary.get("account_code"),
        "contacts_count": len(contacts_items) if isinstance(contacts_items, list) else 0,
        "addresses_count": len(address_items) if isinstance(address_items, list) else 0,
    }


def sync_customer_to_xero(db: Session, *, customer_id: str) -> dict[str, Any]:
    """Push app customer contact details to an already-linked Xero contact."""
    cid = str(customer_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot sync the internal MYOB draft customer.")

    cust = db.scalar(
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(Customer.id == cid)
    )
    if cust is None:
        raise XeroConfigError("Customer not found.")

    xid = str(getattr(cust, "xero_contact_id", "") or "").strip()
    if not xid:
        raise XeroConfigError(
            "Customer is not linked to a Xero contact. Link the customer first, then sync."
        )
    if not _is_uuid(xid):
        raise XeroConfigError("Customer xero_contact_id is not a valid Xero GUID.")

    try:
        contact_body = customer_to_xero_contact_update_body(
            contact_id=xid,
            name=cust.name,
            abn=getattr(cust, "abn", None),
            contact_first_name=getattr(cust, "contact_first_name", None),
            contact_last_name=getattr(cust, "contact_last_name", None),
            email_address=getattr(cust, "email_address", None),
            contact_phone=getattr(cust, "contact_phone", None),
            phones=getattr(cust, "phones", None),
            status=getattr(cust, "status", None),
            contacts=getattr(cust, "contacts", None),
            delivery_addresses=getattr(cust, "delivery_addresses", None),
        )
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    url, _status_code, payload = _xero_api_post_json(
        db,
        endpoint="/Contacts",
        body={"Contacts": [contact_body]},
    )
    contact_raw = _extract_xero_contact_from_post_response(payload)
    contact_id_from_xero = _xero_contact_id(contact_raw)
    if contact_id_from_xero and contact_id_from_xero != xid:
        raise XeroConfigError("Xero contact ID mismatch.")

    cust.xero_last_modified = parse_xero_updated_date_utc(contact_raw.get("UpdatedDateUTC"))
    cust.xero_synced_at = datetime.now(UTC)
    db.add(cust)
    db.commit()

    summary = _xero_contact_summary(contact_raw)
    sent_fields = [
        "name",
        "abn",
        "contact_first_name",
        "contact_last_name",
        "email_address",
        "contact_phone",
        "phones",
        "status",
        "contacts",
        "delivery_addresses",
    ]
    contacts_items = contact_body.get("ContactPersons")
    address_items = contact_body.get("Addresses")
    phone_items = contact_body.get("Phones")
    return {
        "ok": True,
        "direction": "to_xero",
        "customer_id": cid,
        "contact_id": xid,
        "customer_name": cust.name,
        "xero_name": summary.get("name") or cust.name,
        "xero_account_code": summary.get("account_code"),
        "contacts_count": len(contacts_items) if isinstance(contacts_items, list) else 0,
        "addresses_count": len(address_items) if isinstance(address_items, list) else 0,
        "phones_count": len(phone_items) if isinstance(phone_items, list) else 0,
        "sent_fields": sent_fields,
        "request_url": url,
        "xero_last_modified": (
            cust.xero_last_modified.isoformat() if cust.xero_last_modified is not None else None
        ),
    }


def sync_customer_from_xero(
    db: Session,
    *,
    customer_id: str,
    skip_if_not_newer: bool = False,
    sync_source: str = "manual",
) -> dict[str, Any]:
    """Pull contact details from Xero into an already-linked app customer."""
    cid = str(customer_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot sync the internal MYOB draft customer.")

    cust = db.get(Customer, cid)
    if cust is None:
        raise XeroConfigError("Customer not found.")

    xid = str(getattr(cust, "xero_contact_id", "") or "").strip()
    if not xid:
        raise XeroConfigError(
            "Customer is not linked to a Xero contact. Link the customer first, then sync."
        )
    if not _is_uuid(xid):
        raise XeroConfigError("Customer xero_contact_id is not a valid Xero GUID.")

    _, _, payload = _xero_api_get_json(db, endpoint=f"/Contacts/{xid}")
    contacts = payload.get("Contacts") if isinstance(payload, dict) else None
    contact_raw = contacts[0] if isinstance(contacts, list) and contacts else None
    if not isinstance(contact_raw, dict):
        raise XeroConfigError("Xero contact not found.")

    try:
        mapped = customer_fields_from_xero_contact(contact_raw)
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    xero_updated = mapped.get("xero_last_modified")
    stored_modified = getattr(cust, "xero_last_modified", None)
    if skip_if_not_newer and xero_updated is not None and stored_modified is not None:
        if _as_utc_aware(xero_updated) <= _as_utc_aware(stored_modified):
            return {
                "ok": True,
                "skipped": True,
                "skip_reason": "not_newer_than_stored",
                "sync_source": sync_source,
                "customer_id": cid,
                "contact_id": xid,
                "customer_name": cust.name,
                "xero_last_modified": stored_modified.isoformat(),
            }

    ensure_default_customer_brands(db)

    contact_id_from_xero = _xero_contact_id(contact_raw)
    if contact_id_from_xero and contact_id_from_xero != xid:
        raise XeroConfigError("Xero contact ID mismatch.")

    contacts_items = mapped["contacts"].get("items") if isinstance(mapped.get("contacts"), dict) else []
    address_items = (
        mapped["delivery_addresses"].get("items")
        if isinstance(mapped.get("delivery_addresses"), dict)
        else []
    )
    phone_items = mapped["phones"].get("items") if isinstance(mapped.get("phones"), dict) else []

    cust.name = mapped["name"]
    cust.abn = mapped.get("abn")
    cust.contact_first_name = mapped.get("contact_first_name")
    cust.contact_last_name = mapped.get("contact_last_name")
    cust.email_address = mapped.get("email_address")
    cust.contact_phone = mapped.get("contact_phone")
    cust.phones = mapped["phones"]
    cust.status = mapped.get("status") or cust.status
    cust.contacts = mapped["contacts"]
    cust.delivery_addresses = mapped["delivery_addresses"]
    cust.xero_last_modified = mapped.get("xero_last_modified")
    cust.xero_synced_at = datetime.now(UTC)
    brand_code = mapped.get("brand_code")
    xero_theme_id = xero_contact_branding_theme_id(contact_raw)
    brand_id = brand_id_for_xero_branding_theme_id(db, xero_theme_id) if xero_theme_id else None
    if not brand_id and brand_code:
        brand_id = brand_id_for_code(db, brand_code)
    if brand_id:
        cust.brand_id = brand_id

    db.add(cust)
    db.commit()

    summary = _xero_contact_summary(contact_raw)
    updated_fields = [
        "name",
        "abn",
        "contact_first_name",
        "contact_last_name",
        "email_address",
        "contact_phone",
        "phones",
        "status",
        "contacts",
        "delivery_addresses",
        "xero_last_modified",
        "xero_synced_at",
    ]
    if brand_id:
        updated_fields.append("brand_id")
    return {
        "ok": True,
        "sync_source": sync_source,
        "customer_id": cid,
        "contact_id": xid,
        "customer_name": cust.name,
        "xero_name": summary.get("name") or mapped["name"],
        "xero_account_code": summary.get("account_code"),
        "brand_code": brand_code,
        "contacts_count": len(contacts_items) if isinstance(contacts_items, list) else 0,
        "addresses_count": len(address_items) if isinstance(address_items, list) else 0,
        "phones_count": len(phone_items) if isinstance(phone_items, list) else 0,
        "updated_fields": updated_fields,
    }


def _app_customer_fields_for_merge(customer: Customer) -> dict[str, Any]:
    brand = getattr(customer, "brand", None)
    return {
        "name": customer.name,
        "abn": getattr(customer, "abn", None),
        "contact_first_name": getattr(customer, "contact_first_name", None),
        "contact_last_name": getattr(customer, "contact_last_name", None),
        "email_address": getattr(customer, "email_address", None),
        "contact_phone": getattr(customer, "contact_phone", None),
        "phones": getattr(customer, "phones", None),
        "status": getattr(customer, "status", None),
        "contacts": getattr(customer, "contacts", None),
        "delivery_addresses": getattr(customer, "delivery_addresses", None),
        "brand_id": getattr(customer, "brand_id", None),
        "brand_code": getattr(brand, "code", None) if brand else None,
    }


def _apply_merged_customer_fields_to_model(
    db: Session,
    cust: Customer,
    merged: dict[str, Any],
    *,
    contact_raw: dict[str, Any],
) -> str | None:
    """Write merged fields onto the app customer; return brand_id if updated."""
    ensure_default_customer_brands(db)

    cust.name = merged["name"]
    cust.abn = merged.get("abn")
    cust.contact_first_name = merged.get("contact_first_name")
    cust.contact_last_name = merged.get("contact_last_name")
    cust.email_address = merged.get("email_address")
    cust.contact_phone = merged.get("contact_phone")
    cust.phones = merged["phones"]
    cust.status = merged.get("status") or cust.status
    cust.contacts = merged["contacts"]
    cust.delivery_addresses = merged["delivery_addresses"]
    cust.xero_last_modified = merged.get("xero_last_modified")
    cust.xero_synced_at = datetime.now(UTC)

    brand_id: str | None = getattr(cust, "brand_id", None)
    if not brand_id:
        brand_code = merged.get("brand_code")
        xero_theme_id = xero_contact_branding_theme_id(contact_raw)
        brand_id = brand_id_for_xero_branding_theme_id(db, xero_theme_id) if xero_theme_id else None
        if not brand_id and brand_code:
            brand_id = brand_id_for_code(db, brand_code)
        if brand_id:
            cust.brand_id = brand_id
    return brand_id


def merge_customer_with_xero(db: Session, *, customer_id: str) -> dict[str, Any]:
    """Merge linked app and Xero customer fields, save to the app, and push to Xero."""
    cid = str(customer_id or "").strip()
    if not cid:
        raise XeroConfigError("customer_id is required.")
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        raise XeroConfigError("Cannot merge the internal MYOB draft customer.")

    cust = db.scalar(
        select(Customer)
        .options(joinedload(Customer.brand))
        .where(Customer.id == cid)
    )
    if cust is None:
        raise XeroConfigError("Customer not found.")

    xid = str(getattr(cust, "xero_contact_id", "") or "").strip()
    if not xid:
        raise XeroConfigError(
            "Customer is not linked to a Xero contact. Link the customer first, then merge."
        )
    if not _is_uuid(xid):
        raise XeroConfigError("Customer xero_contact_id is not a valid Xero GUID.")

    _, _, payload = _xero_api_get_json(db, endpoint=f"/Contacts/{xid}")
    contacts = payload.get("Contacts") if isinstance(payload, dict) else None
    contact_raw = contacts[0] if isinstance(contacts, list) and contacts else None
    if not isinstance(contact_raw, dict):
        raise XeroConfigError("Xero contact not found.")

    try:
        xero_fields = customer_fields_from_xero_contact(contact_raw)
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    contact_id_from_xero = _xero_contact_id(contact_raw)
    if contact_id_from_xero and contact_id_from_xero != xid:
        raise XeroConfigError("Xero contact ID mismatch.")

    try:
        merge_out = merge_customer_fields_from_app_and_xero(
            app_fields=_app_customer_fields_for_merge(cust),
            xero_fields=xero_fields,
        )
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    merged = merge_out["merged"]
    field_sources = merge_out["field_sources"]

    brand_id = _apply_merged_customer_fields_to_model(
        db,
        cust,
        merged,
        contact_raw=contact_raw,
    )

    try:
        contact_body = customer_to_xero_contact_update_body(
            contact_id=xid,
            name=merged["name"],
            abn=merged.get("abn"),
            contact_first_name=merged.get("contact_first_name"),
            contact_last_name=merged.get("contact_last_name"),
            email_address=merged.get("email_address"),
            contact_phone=merged.get("contact_phone"),
            phones=merged.get("phones"),
            status=merged.get("status"),
            contacts=merged.get("contacts"),
            delivery_addresses=merged.get("delivery_addresses"),
            replace_all_xero_address_types=True,
        )
    except ValueError as e:
        raise XeroConfigError(str(e)) from e

    url, _status_code, post_payload = _xero_api_post_json(
        db,
        endpoint="/Contacts",
        body={"Contacts": [contact_body]},
    )
    contact_raw_after = _extract_xero_contact_from_post_response(post_payload)
    contact_id_after = _xero_contact_id(contact_raw_after)
    if contact_id_after and contact_id_after != xid:
        raise XeroConfigError("Xero contact ID mismatch.")

    cust.xero_last_modified = parse_xero_updated_date_utc(contact_raw_after.get("UpdatedDateUTC"))
    cust.xero_synced_at = datetime.now(UTC)
    db.add(cust)
    db.commit()

    summary = _xero_contact_summary(contact_raw_after)
    contacts_items = merged["contacts"].get("items") if isinstance(merged.get("contacts"), dict) else []
    address_items = (
        merged["delivery_addresses"].get("items")
        if isinstance(merged.get("delivery_addresses"), dict)
        else []
    )
    phone_items = merged["phones"].get("items") if isinstance(merged.get("phones"), dict) else []
    merged_fields = [
        "name",
        "abn",
        "contact_first_name",
        "contact_last_name",
        "email_address",
        "contact_phone",
        "phones",
        "status",
        "contacts",
        "delivery_addresses",
    ]
    if brand_id:
        merged_fields.append("brand_id")

    return {
        "ok": True,
        "direction": "merge",
        "customer_id": cid,
        "contact_id": xid,
        "customer_name": cust.name,
        "xero_name": summary.get("name") or merged["name"],
        "xero_account_code": summary.get("account_code"),
        "brand_code": merged.get("brand_code"),
        "contacts_count": len(contacts_items) if isinstance(contacts_items, list) else 0,
        "addresses_count": len(address_items) if isinstance(address_items, list) else 0,
        "phones_count": len(phone_items) if isinstance(phone_items, list) else 0,
        "merged_fields": merged_fields,
        "field_sources": field_sources,
        "request_url": url,
        "xero_last_modified": (
            cust.xero_last_modified.isoformat() if cust.xero_last_modified is not None else None
        ),
    }


def list_linked_customers_for_merge(
    db: Session,
    *,
    skip_synced_within: timedelta | None = MERGE_ALL_SKIP_SYNCED_WITHIN,
) -> dict[str, Any]:
    """Linked customers eligible for bulk merge, excluding recently synced rows."""
    rows = list(
        db.scalars(
            select(Customer)
            .where(
                Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
                Customer.xero_contact_id.isnot(None),
            )
            .order_by(Customer.name.asc())
        ).all()
    )
    now = datetime.now(UTC)
    cutoff = now - skip_synced_within if skip_synced_within is not None else None
    items: list[dict[str, Any]] = []
    skipped_recent: list[dict[str, Any]] = []
    for cust in rows:
        contact_id = str(getattr(cust, "xero_contact_id", "") or "").strip()
        if not contact_id:
            continue
        synced_at = getattr(cust, "xero_synced_at", None)
        if cutoff is not None and synced_at is not None:
            synced_at_utc = _as_utc_aware(synced_at)
            if synced_at_utc >= cutoff:
                skipped_recent.append(
                    {
                        "customer_id": str(cust.id),
                        "customer_name": cust.name,
                        "contact_id": contact_id,
                        "xero_synced_at": synced_at_utc.isoformat(),
                    }
                )
                continue
        items.append(
            {
                "customer_id": str(cust.id),
                "customer_name": cust.name,
                "contact_id": contact_id,
                "xero_synced_at": (
                    _as_utc_aware(synced_at).isoformat()
                    if synced_at is not None
                    else None
                ),
            }
        )
    skip_hours = skip_synced_within.total_seconds() / 3600 if skip_synced_within is not None else None
    return {
        "total_linked": len(rows),
        "merge_count": len(items),
        "skipped_recent_count": len(skipped_recent),
        "skip_synced_within_hours": skip_hours,
        "items": items,
        "skipped_recent": skipped_recent,
        # Legacy alias used by older frontend code.
        "total": len(items),
    }


def preview_deletable_unlinked_customers(db: Session) -> dict[str, Any]:
    """Customers with no Xero link that are safe to delete (no orders, quotes, products, job sheets, or plates)."""
    counts = _customer_counts(db)
    rows = list(
        db.scalars(
            select(Customer)
            .where(
                Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
                Customer.xero_contact_id.is_(None),
            )
            .order_by(Customer.name.asc())
        ).all()
    )
    deletable: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    for cust in rows:
        row = _customer_review_row(cust, counts)
        reason = _customer_deletable_reason(row)
        if reason:
            blocked.append({**row, "blocked_reason": reason})
        else:
            deletable.append(row)
    return {
        "total_unlinked": len(rows),
        "deletable_count": len(deletable),
        "blocked_count": len(blocked),
        "deletable": deletable,
        "blocked": blocked,
    }


def delete_deletable_unlinked_customers(db: Session) -> dict[str, Any]:
    """Delete unlinked customers with no orders, quotes, products, job sheets, or plates."""
    deletable_ids = _deletable_unlinked_customers_select()
    try:
        result = db.execute(delete(Customer).where(Customer.id.in_(deletable_ids)))
        db.commit()
    except IntegrityError:
        db.rollback()
        return {
            "ok": False,
            "deleted_count": 0,
            "errors": ["Bulk delete failed: related records still exist."],
        }
    return {
        "ok": True,
        "deleted_count": int(result.rowcount or 0),
        "errors": [],
    }


def preview_xero_customer_links(db: Session) -> dict[str, Any]:
    """
    Match Xero contacts to existing app customers without changing customer details.

    The only field the apply step writes is customers.xero_contact_id. Matching is conservative:
    existing links, unique MYOB/Xero account code, unique ABN/tax number, unique exact name,
    then unique truncated-name prefix match for legacy trimmed app customer names.
    Ambiguous or unmatched contacts are reported for manual review.
    """
    contacts = _load_xero_contacts_for_customer_linking(db)
    customer_stmt = select(Customer).where(Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID))
    customers = list(db.scalars(customer_stmt).all())
    linked_by_xero = {
        str(c.xero_contact_id).strip(): c
        for c in customers
        if str(getattr(c, "xero_contact_id", "") or "").strip()
    }
    by_myob_display = _unique_index(customers, lambda c: _normalize_account_code(c.myob_display_id))
    by_abn = _unique_index(customers, lambda c: _normalize_tax_number(c.abn))
    by_name = _unique_index(customers, lambda c: _normalize_match_text(c.name))
    truncated_name_candidates = [
        (cust, norm)
        for cust in customers
        if (norm := _legacy_truncated_app_name_norm(cust.name))
    ]

    claimed_customer_ids: set[str] = set()
    matches: list[dict[str, Any]] = []
    unmatched_xero: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []

    for raw in contacts:
        contact_id = _xero_contact_id(raw)
        name = str(raw.get("Name") or "").strip()
        account_code = _xero_contact_account_code(raw)
        tax_number = str(raw.get("TaxNumber") or "").strip()
        if not contact_id:
            unmatched_xero.append({"name": name, "reason": "missing_contact_id", "xero": raw})
            continue

        match: Customer | None = linked_by_xero.get(contact_id)
        reason = "existing_xero_contact_id" if match is not None else ""
        if match is None:
            for next_reason, candidate in (
                ("myob_display_id", by_myob_display.get(_normalize_account_code(account_code))),
                ("abn", by_abn.get(_normalize_tax_number(tax_number))),
                ("name", by_name.get(_normalize_match_text(name))),
                (
                    "name_truncated_prefix",
                    _unique_truncated_name_prefix_match(
                        customers,
                        name,
                        truncated_candidates=truncated_name_candidates,
                    ),
                ),
            ):
                if candidate is not None:
                    match = candidate
                    reason = next_reason
                    break

        if match is None:
            detail = xero_contact_match_detail(raw)
            unmatched_xero.append(
                {
                    **detail,
                    "tax_number": tax_number,
                    "primary_address": _xero_primary_address_display(raw),
                    "reason": "no_unique_app_customer_match",
                }
            )
            continue

        existing_xero_id = str(getattr(match, "xero_contact_id", "") or "").strip()
        if existing_xero_id and existing_xero_id != contact_id:
            conflicts.append(
                {
                    "contact_id": contact_id,
                    "name": name,
                    "app_customer_id": str(match.id),
                    "app_customer_name": match.name,
                    "existing_xero_contact_id": existing_xero_id,
                    "reason": "app_customer_already_linked_to_different_contact",
                }
            )
            continue
        if str(match.id) in claimed_customer_ids and reason != "existing_xero_contact_id":
            conflicts.append(
                {
                    "contact_id": contact_id,
                    "name": name,
                    "app_customer_id": str(match.id),
                    "app_customer_name": match.name,
                    "reason": "multiple_xero_contacts_match_same_app_customer",
                }
            )
            continue
        claimed_customer_ids.add(str(match.id))

        matches.append(
            {
                "contact_id": contact_id,
                "xero_name": name,
                "xero_account_code": account_code,
                "app_customer_id": str(match.id),
                "app_customer_name": match.name,
                "myob_display_id": getattr(match, "myob_display_id", None),
                "reason": reason,
                "already_linked": existing_xero_id == contact_id,
                "will_link": not existing_xero_id,
            }
        )

    return {
        "xero_contacts_count": len(contacts),
        "matched_count": len(matches),
        "will_link_count": sum(1 for m in matches if bool(m.get("will_link"))),
        "already_linked_count": sum(1 for m in matches if bool(m.get("already_linked"))),
        "unmatched_xero_count": len(unmatched_xero),
        "conflict_count": len(conflicts),
        "matches": matches,
        "unmatched_xero": unmatched_xero,
        "conflicts": conflicts,
    }


def import_xero_customer_links(db: Session) -> dict[str, Any]:
    preview = preview_xero_customer_links(db)
    linked = 0
    errors: list[str] = []
    for row in preview["matches"]:
        if not row.get("will_link"):
            continue
        customer_id = str(row.get("app_customer_id") or "")
        contact_id = str(row.get("contact_id") or "")
        cust = db.get(Customer, customer_id)
        if cust is None:
            errors.append(f"Customer not found during link: {customer_id}")
            continue
        if str(getattr(cust, "xero_contact_id", "") or "").strip():
            continue
        try:
            with db.begin_nested():
                cust.xero_contact_id = contact_id
                db.add(cust)
                db.flush()
            linked += 1
        except IntegrityError:
            errors.append(f"Xero contact already linked elsewhere: {contact_id}")
    db.commit()
    return {**preview, "ok": not errors, "linked_count": linked, "errors": errors}


def unlinked_xero_customer_review(db: Session) -> dict[str, Any]:
    counts = _customer_counts(db)
    rows = list(
        db.scalars(
            select(Customer)
            .options(joinedload(Customer.brand))
            .where(
                Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
                Customer.xero_contact_id.is_(None),
            )
            .order_by(Customer.name.asc())
        ).all()
    )
    items: list[dict[str, Any]] = []
    for c in rows:
        ccounts = counts.get(str(c.id), {})
        detail = _app_customer_match_detail(
            c,
            orders_count=int(ccounts.get("orders_count", 0)),
        )
        detail["quotes_count"] = int(ccounts.get("quotes_count", 0))
        detail["products_count"] = int(ccounts.get("products_count", 0))
        detail["job_sheets_count"] = int(ccounts.get("job_sheets_count", 0))
        detail["plates_count"] = int(ccounts.get("plates_count", 0))
        items.append(detail)
    items.sort(
        key=lambda r: (
            -int(r["orders_count"]),
            -int(r["quotes_count"]),
            str(r["name"] or "").casefold(),
        )
    )
    return {
        "total": len(items),
        "with_orders_count": sum(1 for r in items if int(r["orders_count"]) > 0),
        "without_orders_count": sum(1 for r in items if int(r["orders_count"]) == 0),
        "items": items,
    }


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


_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)


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
        raise XeroConfigError(
            "Customer has no xero_contact_id. Set it on the customer record (Xero Contact UUID)."
        )
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
