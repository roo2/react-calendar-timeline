"""
Best-effort Xero contact create/sync after app customer save (API create/update).

MYOB import and Xero admin bulk tools do not use this module.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.db.models.domain import Customer, XeroConnection
from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID
from app.db.session import SessionLocal
from app.integrations.xero.service import (
    XeroApiError,
    XeroConfigError,
    XeroOAuthError,
    create_xero_contact_for_customer,
    sync_customer_to_xero,
    xero_configured,
)


def _xero_ready(db) -> bool:
    if not xero_configured():
        return False
    row = db.get(XeroConnection, 1)
    if row is None or not row.refresh_token:
        return False
    return bool(str(row.tenant_id or "").strip())


def sync_customer_to_xero_after_save(*, customer_id: str) -> dict[str, Any]:
    """
    Push a saved app customer to Xero.

    - Linked customers: push app fields to the existing Xero contact.
    - Unlinked customers: create a new Xero contact and link it.

    Failures are returned in the result dict; the customer save is not rolled back.
    """
    cid = str(customer_id or "").strip()
    if not cid:
        return {"status": "skipped", "reason": "missing_customer_id"}
    if cid == str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID):
        return {"status": "skipped", "reason": "system_customer"}

    with SessionLocal() as db:
        if not _xero_ready(db):
            return {"status": "skipped", "reason": "xero_not_connected"}

        xid = str(
            db.scalar(select(Customer.xero_contact_id).where(Customer.id == cid)) or ""
        ).strip()

        try:
            if xid:
                result = sync_customer_to_xero(db, customer_id=cid)
                return {
                    "status": "synced",
                    "customer_id": cid,
                    "contact_id": result.get("contact_id"),
                    "customer_name": result.get("customer_name"),
                }
            result = create_xero_contact_for_customer(db, customer_id=cid)
            return {
                "status": "created",
                "customer_id": cid,
                "contact_id": result.get("contact_id"),
                "customer_name": result.get("customer_name"),
            }
        except (XeroConfigError, XeroOAuthError, XeroApiError) as e:
            return {"status": "failed", "customer_id": cid, "error": str(e)}
