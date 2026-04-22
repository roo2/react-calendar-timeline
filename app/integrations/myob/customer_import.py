"""
One-way MYOB → Production Software customer import.

See `customer_mapping.py` for field mapping rules (pure functions + tests).

Brands: ``D -`` customers (see ``myob_raw_indicates_dolphin_brand``) use the brand row
with ``brands.code = DOLPHIN`` (display name “Dolphin”); others use ``CROWN_PACK``.
Default ``brands`` rows are created by the initial migration and enforced at import time
(``ensure_default_customer_brands``); if Dolphin is missing, ``D -`` imports fall back to
Crown Pack when available.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.domain import Brand, Customer
from app.integrations.myob.customer_mapping import (
    abn_from_myob,
    build_contacts_from_myob,
    build_delivery_addresses_from_myob,
    company_name_from_myob,
    myob_notes_from_raw,
    myob_raw_indicates_dolphin_brand,
    parse_myob_last_modified,
    payment_terms_dict_from_myob,
    primary_phone_from_myob,
    status_from_myob,
)
from app.integrations.myob.service import MyobConfigError, fetch_customers_readonly_preview

CROWN_PACK_BRAND_CODE = "CROWN_PACK"
DOLPHIN_BRAND_CODE = "DOLPHIN"


def crown_pack_brand_id(db: Session) -> str | None:
    """Brand row with code CROWN_PACK (Crown Pack), e.g. created via admin or migration."""
    bid = db.scalar(select(Brand.id).where(Brand.code == CROWN_PACK_BRAND_CODE))
    return str(bid) if bid else None


def dolphin_brand_id(db: Session) -> str | None:
    """Brand row with code DOLPHIN (Dolphin), e.g. created via admin or migration."""
    bid = db.scalar(select(Brand.id).where(Brand.code == DOLPHIN_BRAND_CODE))
    return str(bid) if bid else None


def ensure_default_customer_brands(db: Session) -> None:
    """
    Ensure ``CROWN_PACK`` and ``DOLPHIN`` rows exist so MYOB import can set ``customer.brand_id``.

    Idempotent: no-op when both codes already exist (e.g. after ``0001_initial_schema`` seed).
    """
    added = False
    if crown_pack_brand_id(db) is None:
        db.add(Brand(id=str(uuid.uuid4()), code=CROWN_PACK_BRAND_CODE, name="Crown Pack"))
        added = True
    if dolphin_brand_id(db) is None:
        db.add(Brand(id=str(uuid.uuid4()), code=DOLPHIN_BRAND_CODE, name="Dolphin"))
        added = True
    if added:
        db.commit()


def brand_id_for_myob_upsert(db: Session, raw: dict[str, Any]) -> str | None:
    """
    Default MYOB import brand: Dolphin when the raw card matches ``D -`` rules
    (see ``myob_raw_indicates_dolphin_brand``); otherwise Crown Pack.
    If the preferred brand row is missing from the database, fall back to the other
    when that row exists, else ``None``.
    """
    dolph = myob_raw_indicates_dolphin_brand(raw)
    d_id = dolphin_brand_id(db)
    c_id = crown_pack_brand_id(db)
    if dolph:
        if d_id:
            return d_id
        if c_id:
            return c_id
        return None
    if c_id:
        return c_id
    return d_id


def upsert_customer_from_myob(db: Session, raw: dict[str, Any]) -> str:
    """
    Insert or update a Customer from one MYOB API customer object.
    Returns 'created' or 'updated'.
    """
    uid = raw.get("UID")
    if not isinstance(uid, str) or not uid.strip():
        raise MyobConfigError("MYOB customer missing UID")
    uid = uid.strip()
    display_id = raw.get("DisplayID")
    display_s = str(display_id).strip() if display_id is not None else None

    name = (company_name_from_myob(raw) or "").strip()
    myob_lm = parse_myob_last_modified(raw.get("LastModified"))
    myob_notes = myob_notes_from_raw(raw)
    abn = abn_from_myob(raw)
    status = status_from_myob(raw)
    phone = primary_phone_from_myob(raw)
    contacts = build_contacts_from_myob(raw, myob_uid=uid, company_display_name=name)
    delivery_addresses = build_delivery_addresses_from_myob(raw)
    brand_id = brand_id_for_myob_upsert(db, raw)
    payment_terms = payment_terms_dict_from_myob(raw)

    now = datetime.now(UTC)
    existing = db.scalar(select(Customer).where(Customer.myob_customer_uid == uid))

    if existing is None:
        c = Customer(
            id=str(uuid.uuid4()),
            name=name,
            brand_id=brand_id,
            priority_rank=None,
            abn=abn,
            contact_phone=phone,
            status=status,
            contacts=contacts,
            delivery_addresses=delivery_addresses,
            delivery_preferences={},
            payment_terms=payment_terms,
            notes=None,
            myob_customer_uid=uid,
            myob_display_id=display_s,
            myob_last_modified=myob_lm,
            myob_synced_at=now,
            myob_notes=myob_notes,
        )
        db.add(c)
        db.commit()
        return "created"

    existing.name = name
    existing.abn = abn
    existing.contact_phone = phone
    existing.status = status
    existing.contacts = contacts
    existing.delivery_addresses = delivery_addresses
    existing.myob_display_id = display_s
    existing.myob_last_modified = myob_lm
    existing.myob_synced_at = now
    existing.myob_notes = myob_notes
    if payment_terms is not None:
        existing.payment_terms = payment_terms
    if brand_id is not None:
        existing.brand_id = brand_id
    # Preserve: priority_rank, delivery_preferences, notes (payment_terms synced from MYOB when mappable)
    db.commit()
    return "updated"


def import_customers_from_myob(db: Session) -> dict[str, Any]:
    """
    Fetch all MYOB customers (GET-only) and upsert locally by UID.
    """
    ensure_default_customer_brands(db)
    preview = fetch_customers_readonly_preview(db)
    items = preview.get("items")
    if not isinstance(items, list):
        items = []
    created = 0
    updated = 0
    errors: list[str] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        try:
            op = upsert_customer_from_myob(db, raw)
            if op == "created":
                created += 1
            else:
                updated += 1
        except MyobConfigError as e:
            errors.append(str(e))
        except Exception as e:  # pragma: no cover
            errors.append(str(e))

    return {
        "ok": len(errors) == 0,
        "business_id": preview.get("business_id"),
        "source_count": len(items),
        "truncated": bool(preview.get("truncated")),
        "created": created,
        "updated": updated,
        "errors": errors,
        # Full aggregated MYOB Contact/Customer payload used for this import (debug / validation).
        "myob_json": preview,
    }
