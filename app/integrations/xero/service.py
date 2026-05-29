from __future__ import annotations

import re
import secrets
import sys
from datetime import UTC, date, datetime, timedelta
from typing import Any
from urllib.parse import quote, urlencode, urlsplit, urlunsplit

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.config import XERO_SCOPES, settings
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
from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID
from app.orders.product_line_display import product_code_for_version, product_display_name_for_line
from app.str_norm import strip_trailing_dash_suffix

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
    with httpx.Client(timeout=120.0) as client:
        resp = client.get(url, headers=headers)

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
    with httpx.Client(timeout=120.0) as client:
        resp = client.post(url, headers=headers, json=body)

    try:
        payload: Any = resp.json()
    except Exception:
        payload = resp.text

    if resp.status_code >= 400:
        raise XeroApiError(f"Xero POST error {resp.status_code}: {payload}")

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
        .options(joinedload(Order.customer))
        .options(joinedload(Order.items).joinedload(OrderItem.job_sheet).joinedload(JobSheet.product))
        .options(joinedload(Order.items).joinedload(OrderItem.job_sheet).joinedload(JobSheet.version))
        .options(joinedload(Order.items).joinedload(OrderItem.resell_product))
    ).unique().one_or_none()
    if order is None:
        raise XeroConfigError("Order not found.")
    return order


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


def _normalize_match_text(value: Any) -> str:
    s = str(value or "").casefold()
    s = re.sub(r"&", " and ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


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


def _customer_counts(db: Session) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    pairs = (
        (Order, "orders_count"),
        (SavedQuote, "quotes_count"),
        (Product, "products_count"),
    )
    for model, key in pairs:
        rows = db.execute(
            select(model.customer_id, func.count(model.id)).group_by(model.customer_id)
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
    }


def preview_xero_customer_links(db: Session) -> dict[str, Any]:
    """
    Match Xero contacts to existing app customers without changing customer details.

    The only field the apply step writes is customers.xero_contact_id. Matching is conservative:
    existing links, unique MYOB/Xero account code, unique ABN/tax number, then unique exact name.
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
            ):
                if candidate is not None:
                    match = candidate
                    reason = next_reason
                    break

        if match is None:
            unmatched_xero.append(
                {
                    "contact_id": contact_id,
                    "name": name,
                    "account_code": account_code,
                    "tax_number": tax_number,
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
            .where(
                Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
                Customer.xero_contact_id.is_(None),
            )
            .order_by(Customer.name.asc())
        ).all()
    )
    items = [_customer_review_row(c, counts) for c in rows]
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
