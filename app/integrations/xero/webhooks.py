"""
Xero webhook signature verification and contact event handling.

See: https://developer.xero.com/documentation/guides/webhooks/overview/
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db.models.domain import Customer, XeroConnection
from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID
from app.integrations.xero.service import (
    XeroApiError,
    XeroConfigError,
    XeroOAuthError,
    sync_customer_from_xero,
    xero_configured,
)


def xero_webhook_configured() -> bool:
    return bool(str(getattr(settings, "XERO_WEBHOOK_KEY", "") or "").strip())


def compute_xero_webhook_intent_hash(*, body: bytes, webhook_key: str) -> str:
    """Hash for Xero 'Intent to receive' validation (SHA256 of key + raw body)."""
    digest = hashlib.sha256(webhook_key.encode("utf-8") + body).digest()
    return base64.b64encode(digest).decode("utf-8")


def verify_xero_webhook_signature(*, body: bytes, signature: str, webhook_key: str) -> bool:
    """Verify x-xero-signature header (HMAC-SHA256 of raw body)."""
    sig = str(signature or "").strip()
    if not sig or not webhook_key:
        return False
    expected = base64.b64encode(
        hmac.new(webhook_key.encode("utf-8"), body, hashlib.sha256).digest()
    ).decode("utf-8")
    return hmac.compare_digest(expected, sig)


def _is_intent_to_receive_payload(payload: Any) -> bool:
    return isinstance(payload, dict) and "text" in payload and "events" not in payload


def _xero_tenant_matches(db: Session, tenant_id: str | None) -> bool:
    tid = str(tenant_id or "").strip()
    if not tid:
        return True
    row = db.get(XeroConnection, 1)
    if row is None:
        return False
    connected_tid = str(getattr(row, "tenant_id", "") or "").strip()
    return not connected_tid or connected_tid == tid


def process_xero_webhook_payload(db: Session, *, body: bytes, payload: Any) -> dict[str, Any]:
    """
    Handle Xero webhook POST body.

    Returns intent hash for validation requests, or processing summary for events.
    """
    key = str(getattr(settings, "XERO_WEBHOOK_KEY", "") or "").strip()
    if not key:
        raise XeroConfigError("XERO_WEBHOOK_KEY is not configured.")

    if _is_intent_to_receive_payload(payload):
        return {
            "kind": "intent",
            "hash": compute_xero_webhook_intent_hash(body=body, webhook_key=key),
        }

    if not xero_configured():
        raise XeroConfigError("Xero OAuth is not configured.")

    events = payload.get("events") if isinstance(payload, dict) else None
    if not isinstance(events, list):
        return {"kind": "events", "processed": 0, "results": []}

    results: list[dict[str, Any]] = []
    for raw in events:
        if not isinstance(raw, dict):
            continue
        results.append(_process_contact_event(db, raw))

    return {
        "kind": "events",
        "processed": len(results),
        "results": results,
    }


def _process_contact_event(db: Session, event: dict[str, Any]) -> dict[str, Any]:
    category = str(event.get("eventCategory") or "").strip().upper()
    event_type = str(event.get("eventType") or "").strip().upper()
    contact_id = str(event.get("resourceId") or "").strip()
    tenant_id = str(event.get("tenantId") or "").strip() or None

    base = {
        "event_category": category,
        "event_type": event_type,
        "contact_id": contact_id or None,
        "tenant_id": tenant_id,
    }

    if category != "CONTACT":
        return {**base, "status": "ignored", "reason": "not_contact"}

    if event_type not in {"UPDATE", "CREATE"}:
        return {**base, "status": "ignored", "reason": "unsupported_event_type"}

    if not contact_id:
        return {**base, "status": "ignored", "reason": "missing_resource_id"}

    if not _xero_tenant_matches(db, tenant_id):
        return {**base, "status": "ignored", "reason": "tenant_mismatch"}

    cust = db.scalar(
        select(Customer).where(
            Customer.xero_contact_id == contact_id,
            Customer.id != str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID),
        )
    )
    if cust is None:
        return {**base, "status": "skipped", "reason": "no_linked_customer"}

    try:
        out = sync_customer_from_xero(
            db,
            customer_id=str(cust.id),
            skip_if_not_newer=True,
            sync_source="webhook",
        )
    except (XeroConfigError, XeroOAuthError, XeroApiError) as e:
        return {**base, "status": "failed", "customer_id": str(cust.id), "error": str(e)}

    if out.get("skipped"):
        return {
            **base,
            "status": "skipped",
            "customer_id": str(cust.id),
            "reason": out.get("skip_reason") or "not_newer",
        }

    return {
        **base,
        "status": "updated",
        "customer_id": str(cust.id),
        "customer_name": out.get("customer_name"),
    }


def parse_xero_webhook_body(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise XeroConfigError("Invalid Xero webhook JSON body.") from e
