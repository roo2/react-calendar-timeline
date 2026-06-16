"""
Xero-compatible customer contact person and address JSON shapes.

Primary contact first/last name and email live on the customer row (Xero Contact fields).
``contacts`` JSON holds additional contact people only (Xero ContactPersons).
Addresses map to Xero Addresses; ``phones`` JSON maps to Xero Phones (``contact_phone`` is the primary display phone).
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

XERO_ADDRESS_TYPES = frozenset({"STREET", "POBOX", "DELIVERY"})
XERO_PHONE_TYPES = frozenset({"DEFAULT", "MOBILE", "DDI", "FAX"})

_XERO_DATE_RE = re.compile(r"^/Date\((?P<ms>-?\d+)(?P<offset>[+-]\d{4})?\)/$")


def parse_xero_updated_date_utc(value: Any) -> datetime | None:
    """Parse Xero ``UpdatedDateUTC`` values like ``/Date(1779930270423+0000)/``."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    m = _XERO_DATE_RE.match(s)
    if not m:
        return None
    try:
        ms = int(m.group("ms"))
        return datetime.fromtimestamp(ms / 1000.0, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def split_person_name(full: str) -> tuple[str, str]:
    parts = str(full or "").strip().split(None, 1)
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], parts[1]


def _legacy_address_type_to_xero(raw_type: str) -> str:
    t = str(raw_type or "").strip().casefold()
    if t == "billing":
        return "POBOX"
    if t in ("delivery", "both", ""):
        return "STREET"
    upper = str(raw_type or "").strip().upper()
    if upper in XERO_ADDRESS_TYPES:
        return upper
    return "STREET"


def normalize_address_item(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy app address rows to the Xero-compatible JSON shape."""
    if "address_type" in raw or "address_line1" in raw:
        addr_type = str(raw.get("address_type") or "STREET").strip().upper()
        if addr_type not in XERO_ADDRESS_TYPES:
            addr_type = "STREET"
        out: dict[str, Any] = {"address_type": addr_type}
        for src, dst in (
            ("address_line1", "address_line1"),
            ("address_line2", "address_line2"),
            ("address_line3", "address_line3"),
            ("address_line4", "address_line4"),
            ("city", "city"),
            ("region", "region"),
            ("postal_code", "postal_code"),
            ("country", "country"),
            ("attention_to", "attention_to"),
        ):
            value = str(raw.get(src) or "").strip()
            if value:
                out[dst] = value
        return out

    addr_type = _legacy_address_type_to_xero(str(raw.get("type") or ""))
    out = {"address_type": addr_type}
    line1 = str(raw.get("street1") or raw.get("AddressLine1") or "").strip()
    line2 = str(raw.get("street2") or raw.get("AddressLine2") or "").strip()
    line3 = str(raw.get("address_line3") or raw.get("AddressLine3") or "").strip()
    line4 = str(raw.get("address_line4") or raw.get("AddressLine4") or "").strip()
    if line1:
        out["address_line1"] = line1
    if line2:
        out["address_line2"] = line2
    if line3:
        out["address_line3"] = line3
    if line4:
        out["address_line4"] = line4
    city = str(raw.get("city") or raw.get("suburb") or raw.get("City") or "").strip()
    region = str(raw.get("region") or raw.get("state") or raw.get("Region") or "").strip()
    postal = str(raw.get("postal_code") or raw.get("postcode") or raw.get("PostalCode") or "").strip()
    country = str(raw.get("country") or raw.get("Country") or "").strip()
    attention = str(raw.get("attention_to") or raw.get("contact_name") or raw.get("AttentionTo") or "").strip()
    if city:
        out["city"] = city
    if region:
        out["region"] = region
    if postal:
        out["postal_code"] = postal
    if country:
        out["country"] = country
    if attention:
        out["attention_to"] = attention
    return out


def normalize_contact_item(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize legacy app contact rows to the Xero ContactPerson-compatible JSON shape."""
    if "first_name" in raw or "last_name" in raw:
        first = str(raw.get("first_name") or "").strip()
        last = str(raw.get("last_name") or "").strip()
    else:
        first, last = split_person_name(str(raw.get("name") or "").strip())
    email = str(raw.get("email_address") or raw.get("email") or raw.get("EmailAddress") or "").strip()
    include = raw.get("include_in_emails")
    if include is None:
        include = True
    out: dict[str, Any] = {
        "first_name": first,
        "last_name": last,
        "include_in_emails": bool(include),
    }
    if email:
        out["email_address"] = email
    return out


def _contacts_items_raw(raw: Any) -> list[Any]:
    if isinstance(raw, dict):
        items = raw.get("items")
        return items if isinstance(items, list) else []
    if isinstance(raw, list):
        return raw
    return []


def normalize_contacts(raw: Any) -> dict[str, Any]:
    items = [
        normalize_contact_item(item)
        for item in _contacts_items_raw(raw)
        if isinstance(item, dict)
        and (
            str(item.get("first_name") or item.get("name") or "").strip()
            or str(item.get("last_name") or "").strip()
        )
    ]
    return {"items": items}


def split_primary_contact_from_contacts(
    raw: Any,
    *,
    email_address: str | None = None,
) -> tuple[str, str, str | None, dict[str, Any]]:
    """
    Move the primary contact out of legacy ``contacts`` JSON.

    Prefers a row with legacy ``type`` = ``primary contact``; otherwise uses the first row.
    Returns ``(first_name, last_name, email_fallback, additional_contacts_json)``.
    """
    items_raw = _contacts_items_raw(raw)
    if not items_raw:
        return "", "", None, {"items": []}

    primary_idx = 0
    for idx, row in enumerate(items_raw):
        if not isinstance(row, dict):
            continue
        contact_type = str(row.get("type") or "").strip().casefold()
        if contact_type == "primary contact":
            primary_idx = idx
            break

    primary = normalize_contact_item(items_raw[primary_idx]) if isinstance(items_raw[primary_idx], dict) else {}
    first = str(primary.get("first_name") or "").strip()
    last = str(primary.get("last_name") or "").strip()
    email_fallback = str(primary.get("email_address") or "").strip() or None

    additional: list[dict[str, Any]] = []
    for idx, row in enumerate(items_raw):
        if idx == primary_idx or not isinstance(row, dict):
            continue
        normalized = normalize_contact_item(row)
        if str(normalized.get("first_name") or "").strip() or str(normalized.get("last_name") or "").strip():
            additional.append(normalized)

    new_email = (email_address or "").strip() or email_fallback
    return first, last, new_email or None, {"items": additional}


def normalize_delivery_addresses(raw: Any) -> dict[str, Any]:
    items_raw: list[Any]
    if isinstance(raw, dict):
        items_raw = raw.get("items") if isinstance(raw.get("items"), list) else []
    elif isinstance(raw, list):
        items_raw = raw
    else:
        items_raw = []
    items = [
        normalize_address_item(item)
        for item in items_raw
        if isinstance(item, dict) and address_has_content(normalize_address_item(item))
    ]
    return {"items": items}


def address_has_content(addr: dict[str, Any]) -> bool:
    normalized = normalize_address_item(addr) if "address_type" not in addr and "street1" in addr else addr
    parts = (
        normalized.get("address_line1"),
        normalized.get("address_line2"),
        normalized.get("address_line3"),
        normalized.get("address_line4"),
        normalized.get("city"),
        normalized.get("region"),
        normalized.get("postal_code"),
        normalized.get("country"),
        normalized.get("attention_to"),
    )
    return any(str(p or "").strip() for p in parts)


def pick_default_delivery_address(addresses: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Prefer STREET, then DELIVERY, then POBOX."""
    normalized = [normalize_address_item(a) for a in addresses if isinstance(a, dict)]
    usable = [a for a in normalized if address_has_content(a)]
    if not usable:
        return None
    for preferred in ("STREET", "DELIVERY", "POBOX"):
        for addr in usable:
            if str(addr.get("address_type") or "").upper() == preferred:
                return addr
    return usable[0]


def format_address_display(addr: dict[str, Any] | None) -> str | None:
    if not addr:
        return None
    row = normalize_address_item(addr)
    if not address_has_content(row):
        return None
    lines: list[str] = []
    for key in ("address_line1", "address_line2", "address_line3", "address_line4"):
        value = str(row.get(key) or "").strip()
        if value:
            lines.append(value)
    locality = " ".join(
        p
        for p in (
            str(row.get("city") or "").strip(),
            str(row.get("region") or "").strip(),
            str(row.get("postal_code") or "").strip(),
        )
        if p
    )
    if locality:
        lines.append(locality)
    country = str(row.get("country") or "").strip()
    if country:
        lines.append(country)
    attention = str(row.get("attention_to") or "").strip()
    if attention:
        lines.append(f"Attention: {attention}")
    return "\n".join(lines) if lines else None


def address_item_to_xero_api_row(addr: dict[str, Any], *, address_type: str) -> dict[str, str]:
    row = normalize_address_item(addr)
    out: dict[str, str] = {"AddressType": address_type}
    mapping = (
        ("address_line1", "AddressLine1"),
        ("address_line2", "AddressLine2"),
        ("address_line3", "AddressLine3"),
        ("address_line4", "AddressLine4"),
        ("city", "City"),
        ("region", "Region"),
        ("postal_code", "PostalCode"),
        ("country", "Country"),
        ("attention_to", "AttentionTo"),
    )
    limits = {
        "AddressLine1": 500,
        "AddressLine2": 500,
        "AddressLine3": 500,
        "AddressLine4": 500,
        "City": 255,
        "Region": 255,
        "PostalCode": 50,
        "Country": 50,
        "AttentionTo": 255,
    }
    for src, dst in mapping:
        value = str(row.get(src) or "").strip()
        if value:
            out[dst] = value[: limits[dst]]
    return out


def address_to_xero_api_addresses(addr: dict[str, Any]) -> list[dict[str, str]]:
    """
    Map one app address to Xero contact Addresses for invoice export.

    Xero invoices default to POBOX; duplicate STREET rows to POBOX when needed.
    """
    row = normalize_address_item(addr)
    if not address_has_content(row):
        return []
    addr_type = str(row.get("address_type") or "STREET").upper()
    if addr_type == "POBOX":
        return [address_item_to_xero_api_row(row, address_type="POBOX")]
    if addr_type == "DELIVERY":
        return [address_item_to_xero_api_row(row, address_type="DELIVERY")]
    street = address_item_to_xero_api_row(row, address_type="STREET")
    pobox = address_item_to_xero_api_row(row, address_type="POBOX")
    return [street, pobox]


def _phones_items_raw(raw: Any) -> list[Any]:
    if isinstance(raw, dict):
        items = raw.get("items")
        return items if isinstance(items, list) else []
    if isinstance(raw, list):
        return raw
    return []


def normalize_phone_item(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize app or Xero phone rows to the stored JSON shape."""
    phone_type = str(raw.get("phone_type") or raw.get("PhoneType") or "DEFAULT").strip().upper()
    if phone_type not in XERO_PHONE_TYPES:
        phone_type = "DEFAULT"
    country = str(raw.get("phone_country_code") or raw.get("PhoneCountryCode") or "").strip()
    area = str(raw.get("phone_area_code") or raw.get("PhoneAreaCode") or "").strip()
    number = str(raw.get("phone_number") or raw.get("PhoneNumber") or "").strip()
    if not number and not area and not country:
        legacy = str(raw.get("phone") or raw.get("number") or "").strip()
        if legacy:
            tokens = legacy.split()
            if len(tokens) >= 2 and tokens[0].isdigit() and len(tokens[0]) <= 4:
                area = tokens[0]
                number = " ".join(tokens[1:])
            else:
                number = legacy
    out: dict[str, Any] = {"phone_type": phone_type}
    if country:
        out["phone_country_code"] = country
    if area:
        out["phone_area_code"] = area
    if number:
        out["phone_number"] = number
    return out


def phone_has_content(item: dict[str, Any]) -> bool:
    row = normalize_phone_item(item)
    return any(
        str(row.get(k) or "").strip()
        for k in ("phone_country_code", "phone_area_code", "phone_number")
    )


def format_phone_display(item: dict[str, Any] | None) -> str | None:
    if not item:
        return None
    row = normalize_phone_item(item)
    if not phone_has_content(row):
        return None
    parts = [
        str(row.get("phone_country_code") or "").strip(),
        str(row.get("phone_area_code") or "").strip(),
        str(row.get("phone_number") or "").strip(),
    ]
    text = " ".join(p for p in parts if p)
    return text or None


def primary_phone_display(raw: Any, *, contact_phone: str | None = None) -> str | None:
    """Pick the best display phone (DEFAULT, then MOBILE, DDI, FAX)."""
    items = [
        normalize_phone_item(item)
        for item in _phones_items_raw(raw)
        if isinstance(item, dict) and phone_has_content(item)
    ]
    by_type: dict[str, str] = {}
    for row in items:
        phone_type = str(row.get("phone_type") or "DEFAULT").strip().upper()
        display = format_phone_display(row)
        if phone_type and display:
            by_type[phone_type] = display
    for phone_type in ("DEFAULT", "MOBILE", "DDI", "FAX"):
        value = by_type.get(phone_type)
        if value:
            return value
    for row in items:
        display = format_phone_display(row)
        if display:
            return display
    legacy = str(contact_phone or "").strip()
    return legacy or None


def normalize_phones(raw: Any, *, contact_phone: str | None = None) -> dict[str, Any]:
    """Normalize phones JSON; backfill from legacy ``contact_phone`` when empty."""
    items = [
        normalize_phone_item(item)
        for item in _phones_items_raw(raw)
        if isinstance(item, dict) and phone_has_content(item)
    ]
    if not items:
        legacy = str(contact_phone or "").strip()
        if legacy:
            items = [normalize_phone_item({"phone_type": "DEFAULT", "phone": legacy})]
    return {"items": items}


def phones_from_xero_list(raw: Any) -> dict[str, Any]:
    """Map Xero Phones[] to app phones JSON."""
    if not isinstance(raw, list):
        return {"items": []}
    items: list[dict[str, Any]] = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        normalized = normalize_phone_item(row)
        if phone_has_content(normalized):
            items.append(normalized)
    return {"items": items}


def phone_item_to_xero_api_row(item: dict[str, Any]) -> dict[str, str]:
    row = normalize_phone_item(item)
    out: dict[str, str] = {
        "PhoneType": str(row.get("phone_type") or "DEFAULT").strip().upper() or "DEFAULT",
    }
    country = str(row.get("phone_country_code") or "").strip()
    area = str(row.get("phone_area_code") or "").strip()
    number = str(row.get("phone_number") or "").strip()
    if country:
        out["PhoneCountryCode"] = country[:20]
    if area:
        out["PhoneAreaCode"] = area[:10]
    if number:
        out["PhoneNumber"] = number[:50]
    return out


def app_phones_to_xero_phones(raw: Any, *, contact_phone: str | None = None) -> list[dict[str, str]]:
    """Map app phones JSON to Xero Phones[]."""
    items = normalize_phones(raw, contact_phone=contact_phone).get("items", [])
    rows: list[dict[str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        row = phone_item_to_xero_api_row(item)
        if any(row.get(k) for k in ("PhoneCountryCode", "PhoneAreaCode", "PhoneNumber")):
            rows.append(row)
    return rows


def phone_summaries(raw: Any, *, contact_phone: str | None = None) -> list[dict[str, str]]:
    """Summaries for API/admin display: phone_type + formatted display."""
    summaries: list[dict[str, str]] = []
    for item in normalize_phones(raw, contact_phone=contact_phone).get("items", []):
        if not isinstance(item, dict):
            continue
        display = format_phone_display(item)
        if not display:
            continue
        phone_type = str(item.get("phone_type") or "DEFAULT").strip().upper()
        summaries.append({"phone_type": phone_type, "display": display})
    return summaries
