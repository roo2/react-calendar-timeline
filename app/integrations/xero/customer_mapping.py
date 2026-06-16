"""
Pure Xero Contact → app customer field mapping (no DB side effects).

Used by sync-from-xero and unit tests.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.customers.contact_address import (
    address_has_content,
    address_item_to_xero_api_row,
    app_phones_to_xero_phones,
    format_address_display,
    format_phone_display,
    normalize_address_item,
    normalize_contacts,
    normalize_delivery_addresses,
    normalize_phones,
    parse_xero_updated_date_utc,
    phones_from_xero_list,
    primary_phone_display,
)


CROWN_PACK_BRAND_CODE = "CROWN_PACK"
DOLPHIN_BRAND_CODE = "DOLPHIN"
APPROVED_PACKAGING_BRAND_CODE = "APPROVED_PACKAGING"
XERO_ADDRESS_TYPES_ORDER = ("STREET", "POBOX", "DELIVERY")


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
            "AttentionTo",
        )
    )


def _xero_address_signature(addr: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        str(addr.get(k) or "").strip().casefold()
        for k in (
            "AddressType",
            "AddressLine1",
            "AddressLine2",
            "AddressLine3",
            "AddressLine4",
            "City",
            "Region",
            "PostalCode",
            "Country",
            "AttentionTo",
        )
    )


def _format_xero_phone(raw: dict[str, Any]) -> str:
    parts = [
        str(raw.get("PhoneCountryCode") or "").strip(),
        str(raw.get("PhoneAreaCode") or "").strip(),
        str(raw.get("PhoneNumber") or "").strip(),
    ]
    return " ".join(p for p in parts if p)


def _pick_xero_phone(phones: Any) -> str | None:
    if not isinstance(phones, list):
        return None
    by_type: dict[str, str] = {}
    for row in phones:
        if not isinstance(row, dict):
            continue
        phone_type = str(row.get("PhoneType") or "").strip().upper()
        formatted = _format_xero_phone(row)
        if phone_type and formatted:
            by_type[phone_type] = formatted
    for phone_type in ("DEFAULT", "MOBILE", "DDI", "FAX"):
        value = by_type.get(phone_type)
        if value:
            return value
    for row in phones:
        if isinstance(row, dict):
            formatted = _format_xero_phone(row)
            if formatted:
                return formatted
    return None


def _status_from_xero(raw: dict[str, Any]) -> str:
    status = str(raw.get("ContactStatus") or raw.get("Status") or "").strip().upper()
    if status == "ARCHIVED":
        return "Archived"
    if status == "INACTIVE":
        return "Inactive"
    return "Active"


def brand_code_from_xero_branding_theme(raw: dict[str, Any]) -> str | None:
    """Map Xero contact BrandingTheme.Name to an app brand code."""
    theme = raw.get("BrandingTheme")
    if not isinstance(theme, dict):
        return None
    name = str(theme.get("Name") or "").strip().casefold()
    if not name:
        return None
    if "approved packaging" in name:
        return APPROVED_PACKAGING_BRAND_CODE
    if "dolphin" in name:
        return DOLPHIN_BRAND_CODE
    if "crown pack" in name or "crownpack" in name or "crown" in name:
        return CROWN_PACK_BRAND_CODE
    return None


def branding_theme_match_needles(brand_code: str | None, brand_name: str | None) -> list[str]:
    """Search needles for matching a Xero BrandingTheme.Name to an app brand."""
    code = str(brand_code or "").strip().upper()
    if code == APPROVED_PACKAGING_BRAND_CODE:
        return ["approved packaging"]
    if code == DOLPHIN_BRAND_CODE:
        return ["dolphin plastics", "dolphin"]
    if code == CROWN_PACK_BRAND_CODE:
        return ["crown pack", "crownpack", "crown"]
    name = str(brand_name or "").strip()
    return [name.casefold()] if name else []


def _score_branding_theme_name(theme_name: str, needles: list[str]) -> int:
    normalized = str(theme_name or "").strip().casefold()
    if not normalized:
        return 0
    best = 0
    for needle in needles:
        n = str(needle or "").strip().casefold()
        if not n:
            continue
        if normalized == n:
            return 1000 + len(n)
        if normalized.startswith(n):
            best = max(best, 500 + len(n))
        elif n in normalized:
            best = max(best, len(n))
    return best


def pick_xero_branding_theme_id_from_list(
    themes: Any,
    *,
    brand_code: str | None,
    brand_name: str | None,
) -> str | None:
    """Pick the best matching Xero BrandingThemeID for an app brand."""
    needles = branding_theme_match_needles(brand_code, brand_name)
    if not needles or not isinstance(themes, list):
        return None

    best_id: str | None = None
    best_score = 0
    for raw in themes:
        if not isinstance(raw, dict):
            continue
        theme_name = str(raw.get("Name") or "").strip()
        score = _score_branding_theme_name(theme_name, needles)
        if score <= 0:
            continue
        theme_id = str(raw.get("BrandingThemeID") or raw.get("BrandingThemeId") or "").strip()
        if theme_id and score > best_score:
            best_score = score
            best_id = theme_id
    return best_id


def xero_contact_branding_theme_id(raw: dict[str, Any]) -> str | None:
    theme = raw.get("BrandingTheme")
    if not isinstance(theme, dict):
        return None
    theme_id = str(theme.get("BrandingThemeID") or theme.get("BrandingThemeId") or "").strip()
    return theme_id or None


def _address_item_from_xero(raw: dict[str, Any]) -> dict[str, Any]:
    addr_type = str(raw.get("AddressType") or "STREET").strip().upper()
    if addr_type not in {"STREET", "POBOX", "DELIVERY"}:
        addr_type = "STREET"
    item: dict[str, Any] = {"address_type": addr_type}
    for src, dst in (
        ("AddressLine1", "address_line1"),
        ("AddressLine2", "address_line2"),
        ("AddressLine3", "address_line3"),
        ("AddressLine4", "address_line4"),
        ("City", "city"),
        ("Region", "region"),
        ("PostalCode", "postal_code"),
        ("Country", "country"),
        ("AttentionTo", "attention_to"),
    ):
        value = str(raw.get(src) or "").strip()
        if value:
            item[dst] = value
    return item


def delivery_addresses_from_xero_contact(raw: dict[str, Any]) -> dict[str, Any]:
    """Map Xero Addresses[] to app delivery_addresses JSON shape."""
    addrs = raw.get("Addresses")
    if not isinstance(addrs, list):
        return {"items": []}

    items: list[dict[str, Any]] = []
    seen_signatures: set[tuple[str, ...]] = set()
    for row in addrs:
        if not isinstance(row, dict) or not _xero_address_has_content(row):
            continue
        signature = _xero_address_signature(row)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)
        items.append(_address_item_from_xero(row))
    return {"items": items}


def xero_contact_match_detail(raw: dict[str, Any]) -> dict[str, Any]:
    """Rich Xero contact fields for admin link/sync comparison UI."""
    theme = raw.get("BrandingTheme")
    branding_theme_name: str | None = None
    branding_theme_id: str | None = None
    if isinstance(theme, dict):
        branding_theme_name = str(theme.get("Name") or "").strip() or None
        branding_theme_id = (
            str(theme.get("BrandingThemeID") or theme.get("BrandingThemeId") or "").strip() or None
        )

    contact_persons: list[str] = []
    for item in contacts_from_xero_contact(raw).get("items", []):
        first = str(item.get("first_name") or "").strip()
        last = str(item.get("last_name") or "").strip()
        label = " ".join(part for part in (first, last) if part)
        email = str(item.get("email_address") or "").strip()
        if label and email:
            label = f"{label} ({email})"
        elif email:
            label = email
        if label:
            contact_persons.append(label)

    addresses: list[dict[str, str]] = []
    for item in delivery_addresses_from_xero_contact(raw).get("items", []):
        display = format_address_display(item)
        if not display:
            continue
        addr_type = str(item.get("address_type") or "STREET").strip().upper()
        addresses.append({"address_type": addr_type, "display": display})

    phones: list[dict[str, str]] = []
    for item in phones_from_xero_list(raw.get("Phones")).get("items", []):
        display = format_phone_display(item)
        if not display:
            continue
        phone_type = str(item.get("phone_type") or "DEFAULT").strip().upper()
        phones.append({"phone_type": phone_type, "display": display})

    lm = parse_xero_updated_date_utc(raw.get("UpdatedDateUTC"))

    return {
        "contact_id": str(raw.get("ContactID") or "").strip() or None,
        "name": str(raw.get("Name") or "").strip(),
        "account_code": str(raw.get("AccountNumber") or raw.get("AccountCode") or "").strip() or None,
        "abn": str(raw.get("TaxNumber") or "").strip() or None,
        "brand_name": branding_theme_name,
        "brand_code": brand_code_from_xero_branding_theme(raw),
        "branding_theme_id": branding_theme_id,
        "contact_first_name": str(raw.get("FirstName") or "").strip() or None,
        "contact_last_name": str(raw.get("LastName") or "").strip() or None,
        "email_address": str(raw.get("EmailAddress") or "").strip() or None,
        "contact_phone": _pick_xero_phone(raw.get("Phones")),
        "phones": phones,
        "status": _status_from_xero(raw),
        "contact_persons": contact_persons,
        "addresses": addresses,
        "xero_last_modified": lm.isoformat() if lm is not None else None,
    }


def contacts_from_xero_contact(raw: dict[str, Any]) -> dict[str, Any]:
    """Map Xero ContactPersons to app contacts JSON shape."""
    items: list[dict[str, Any]] = []
    persons = raw.get("ContactPersons")
    if isinstance(persons, list):
        for row in persons:
            if not isinstance(row, dict):
                continue
            first = str(row.get("FirstName") or "").strip()
            last = str(row.get("LastName") or "").strip()
            if not first and not last:
                continue
            item: dict[str, Any] = {
                "first_name": first,
                "last_name": last,
                "include_in_emails": bool(row.get("IncludeInEmails", True)),
            }
            email = str(row.get("EmailAddress") or "").strip()
            if email:
                item["email_address"] = email
            items.append(item)
    return {"items": items}


def status_to_xero(status: str | None) -> str:
    s = str(status or "").strip().casefold()
    if s == "archived":
        return "ARCHIVED"
    if s == "inactive":
        return "INACTIVE"
    return "ACTIVE"


def phone_to_xero_phones(phone: str | None, *, phones: Any = None) -> list[dict[str, str]]:
    """Map app customer phones JSON (or legacy single phone) to Xero Phones[]."""
    return app_phones_to_xero_phones(phones, contact_phone=phone)


def app_delivery_addresses_to_xero_addresses(
    delivery_addresses: Any,
    *,
    replace_all_xero_address_types: bool = False,
) -> list[dict[str, str]]:
    """
    Map app delivery_addresses JSON to Xero Addresses[] (at most one row per address type).

    When ``replace_all_xero_address_types`` is true, emit STREET/POBOX/DELIVERY rows for every
    Xero address slot so omitted types are cleared on contact update.
    """
    by_type = _addresses_by_type(normalize_delivery_addresses(delivery_addresses).get("items", []))
    rows: list[dict[str, str]] = []
    for addr_type in XERO_ADDRESS_TYPES_ORDER:
        addr = by_type.get(addr_type)
        if addr is not None:
            rows.append(address_item_to_xero_api_row(addr, address_type=addr_type))
        elif replace_all_xero_address_types:
            rows.append({"AddressType": addr_type})
    return rows


def app_contacts_to_xero_contact_persons(contacts: Any) -> list[dict[str, Any]]:
    """Map app contacts JSON to Xero ContactPersons[]."""
    items = normalize_contacts(contacts)["items"]
    rows: list[dict[str, Any]] = []
    for item in items:
        first = str(item.get("first_name") or "").strip()
        last = str(item.get("last_name") or "").strip()
        if not first and not last:
            continue
        row: dict[str, Any] = {
            "FirstName": first,
            "LastName": last,
            "IncludeInEmails": bool(item.get("include_in_emails", True)),
        }
        email = str(item.get("email_address") or "").strip()
        if email:
            row["EmailAddress"] = email
        rows.append(row)
    return rows


def customer_to_xero_contact_create_body(
    *,
    name: str,
    abn: str | None = None,
    contact_first_name: str | None = None,
    contact_last_name: str | None = None,
    email_address: str | None = None,
    contact_phone: str | None = None,
    phones: Any = None,
    status: str | None = None,
    contacts: Any = None,
    delivery_addresses: Any = None,
) -> dict[str, Any]:
    """Build a Xero Contacts API create payload from app customer fields."""
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Customer name is required to create a Xero contact.")

    body: dict[str, Any] = {
        "Name": clean_name,
        "ContactStatus": status_to_xero(status),
        "Addresses": app_delivery_addresses_to_xero_addresses(delivery_addresses),
        "ContactPersons": app_contacts_to_xero_contact_persons(contacts),
    }
    first = str(contact_first_name or "").strip()
    last = str(contact_last_name or "").strip()
    if first:
        body["FirstName"] = first
    if last:
        body["LastName"] = last
    tax = str(abn or "").strip()
    if tax:
        body["TaxNumber"] = tax
    email = str(email_address or "").strip()
    if email:
        body["EmailAddress"] = email
    phones = phone_to_xero_phones(contact_phone, phones=phones)
    if phones:
        body["Phones"] = phones
    return body


def customer_to_xero_contact_update_body(
    *,
    contact_id: str,
    name: str,
    abn: str | None = None,
    contact_first_name: str | None = None,
    contact_last_name: str | None = None,
    email_address: str | None = None,
    contact_phone: str | None = None,
    phones: Any = None,
    status: str | None = None,
    contacts: Any = None,
    delivery_addresses: Any = None,
    replace_all_xero_address_types: bool = False,
) -> dict[str, Any]:
    """Build a Xero Contacts API update payload from app customer fields."""
    xid = str(contact_id or "").strip()
    if not xid:
        raise ValueError("Xero contact ID is required.")
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("Customer name is required to sync to Xero.")

    body: dict[str, Any] = {
        "ContactID": xid,
        "Name": clean_name,
        "ContactStatus": status_to_xero(status),
        "Addresses": app_delivery_addresses_to_xero_addresses(
            delivery_addresses,
            replace_all_xero_address_types=replace_all_xero_address_types,
        ),
        "ContactPersons": app_contacts_to_xero_contact_persons(contacts),
    }
    first = str(contact_first_name or "").strip()
    last = str(contact_last_name or "").strip()
    if first:
        body["FirstName"] = first
    if last:
        body["LastName"] = last
    tax = str(abn or "").strip()
    if tax:
        body["TaxNumber"] = tax
    email = str(email_address or "").strip()
    if email:
        body["EmailAddress"] = email
    phones = phone_to_xero_phones(contact_phone, phones=phones)
    if phones:
        body["Phones"] = phones
    return body


def _merge_text_present(value: Any) -> bool:
    return bool(str(value or "").strip())


def _pick_merged_scalar(app_val: Any, xero_val: Any) -> tuple[Any, str]:
    """Prefer app when both sides have a value; otherwise use whichever side is populated."""
    if _merge_text_present(app_val):
        return str(app_val).strip(), "app"
    if _merge_text_present(xero_val):
        return str(xero_val).strip() if isinstance(xero_val, str) else xero_val, "xero"
    return None, "none"


def _pick_merged_list_by_length(
    app_norm: dict[str, Any],
    xero_norm: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    """Prefer the longer list; when equal length, prefer the app list."""
    app_items = app_norm.get("items") if isinstance(app_norm.get("items"), list) else []
    xero_items = xero_norm.get("items") if isinstance(xero_norm.get("items"), list) else []
    if len(xero_items) > len(app_items):
        return {"items": xero_items}, "xero"
    if app_items:
        return {"items": app_items}, "app"
    if xero_items:
        return {"items": xero_items}, "xero"
    return {"items": []}, "none"


def _pick_merged_json_list(
    app_json: Any,
    xero_json: Any,
    *,
    normalize_fn,
) -> tuple[dict[str, Any], str]:
    """Use the longer list; when equal length, use the app list."""
    app_norm = normalize_fn(app_json)
    xero_norm = normalize_fn(xero_json)
    return _pick_merged_list_by_length(app_norm, xero_norm)


def _pick_merged_phones(
    app_phones: Any,
    app_contact_phone: Any,
    xero_phones: Any,
) -> tuple[dict[str, Any], str]:
    """Use the longer phone list; when equal length, use the app list."""
    app_norm = normalize_phones(app_phones, contact_phone=app_contact_phone)
    xero_norm = normalize_phones(xero_phones)
    return _pick_merged_list_by_length(app_norm, xero_norm)


def _addresses_by_type(items: Any) -> dict[str, dict[str, Any]]:
    """Index normalized address rows by Xero address type (first row wins per type)."""
    by_type: dict[str, dict[str, Any]] = {}
    if not isinstance(items, list):
        return by_type
    for addr in items:
        if not isinstance(addr, dict):
            continue
        normalized = normalize_address_item(addr)
        if not address_has_content(normalized):
            continue
        addr_type = str(normalized.get("address_type") or "STREET").strip().upper()
        if addr_type not in XERO_ADDRESS_TYPES_ORDER:
            addr_type = "STREET"
        if addr_type not in by_type:
            by_type[addr_type] = normalized
    return by_type


def _pick_merged_delivery_addresses(
    app_json: Any,
    xero_json: Any,
) -> tuple[dict[str, Any], str]:
    """
    Combine STREET/POBOX/DELIVERY into one list.

    For each address type, prefer the app row when present; otherwise use Xero.
    """
    app_by_type = _addresses_by_type(normalize_delivery_addresses(app_json).get("items", []))
    xero_by_type = _addresses_by_type(normalize_delivery_addresses(xero_json).get("items", []))

    merged_items: list[dict[str, Any]] = []
    sources: list[str] = []
    for addr_type in XERO_ADDRESS_TYPES_ORDER:
        if addr_type in app_by_type:
            merged_items.append(app_by_type[addr_type])
            sources.append("app")
        elif addr_type in xero_by_type:
            merged_items.append(xero_by_type[addr_type])
            sources.append("xero")

    if not merged_items:
        return {"items": []}, "none"
    if all(source == "app" for source in sources):
        return {"items": merged_items}, "app"
    if all(source == "xero" for source in sources):
        return {"items": merged_items}, "xero"
    return {"items": merged_items}, "mixed"


def _pick_merged_brand_code(
    *,
    app_brand_id: Any,
    app_brand_code: Any,
    xero_brand_code: Any,
) -> tuple[str | None, str]:
    if app_brand_id and _merge_text_present(app_brand_code):
        return str(app_brand_code).strip(), "app"
    if app_brand_id:
        return None, "app"
    if _merge_text_present(xero_brand_code):
        return str(xero_brand_code).strip(), "xero"
    return None, "none"


def merge_customer_fields_from_app_and_xero(
    *,
    app_fields: dict[str, Any],
    xero_fields: dict[str, Any],
) -> dict[str, Any]:
    """
    Field-by-field merge for linked customer sync.

    Scalars prefer the app when both sides have a value. Phones and contact persons use the
    longer side; when lengths match, use the app list. Addresses combine STREET/POBOX/DELIVERY
    into one list, preferring the app row per type when both sides have that type.
    """
    field_sources: dict[str, str] = {}

    name, field_sources["name"] = _pick_merged_scalar(app_fields.get("name"), xero_fields.get("name"))
    if not _merge_text_present(name):
        raise ValueError("Merged customer name is empty.")

    abn, field_sources["abn"] = _pick_merged_scalar(app_fields.get("abn"), xero_fields.get("abn"))
    contact_first_name, field_sources["contact_first_name"] = _pick_merged_scalar(
        app_fields.get("contact_first_name"),
        xero_fields.get("contact_first_name"),
    )
    contact_last_name, field_sources["contact_last_name"] = _pick_merged_scalar(
        app_fields.get("contact_last_name"),
        xero_fields.get("contact_last_name"),
    )
    email_address, field_sources["email_address"] = _pick_merged_scalar(
        app_fields.get("email_address"),
        xero_fields.get("email_address"),
    )
    status, field_sources["status"] = _pick_merged_scalar(
        app_fields.get("status"),
        xero_fields.get("status"),
    )

    phones, field_sources["phones"] = _pick_merged_phones(
        app_fields.get("phones"),
        app_fields.get("contact_phone"),
        xero_fields.get("phones"),
    )
    contact_phone = primary_phone_display(phones)
    field_sources["contact_phone"] = field_sources["phones"]

    contacts, field_sources["contacts"] = _pick_merged_json_list(
        app_fields.get("contacts"),
        xero_fields.get("contacts"),
        normalize_fn=normalize_contacts,
    )
    delivery_addresses, field_sources["delivery_addresses"] = _pick_merged_delivery_addresses(
        app_fields.get("delivery_addresses"),
        xero_fields.get("delivery_addresses"),
    )
    brand_code, field_sources["brand_code"] = _pick_merged_brand_code(
        app_brand_id=app_fields.get("brand_id"),
        app_brand_code=app_fields.get("brand_code"),
        xero_brand_code=xero_fields.get("brand_code"),
    )

    merged = {
        "name": name,
        "abn": abn,
        "contact_first_name": contact_first_name,
        "contact_last_name": contact_last_name,
        "email_address": email_address,
        "contact_phone": contact_phone,
        "phones": phones,
        "status": status or "Active",
        "contacts": contacts,
        "delivery_addresses": delivery_addresses,
        "brand_code": brand_code,
        "xero_last_modified": xero_fields.get("xero_last_modified"),
    }
    return {"merged": merged, "field_sources": field_sources}


def customer_fields_from_xero_contact(raw: dict[str, Any]) -> dict[str, Any]:
    """Map a full Xero Contact payload to updatable app customer fields."""
    name = str(raw.get("Name") or "").strip()
    if not name:
        raise ValueError("Xero contact is missing Name.")

    tax_number = str(raw.get("TaxNumber") or "").strip() or None
    phones = phones_from_xero_list(raw.get("Phones"))
    contact_phone = primary_phone_display(phones)
    email_address = str(raw.get("EmailAddress") or "").strip() or None
    contact_first_name = str(raw.get("FirstName") or "").strip() or None
    contact_last_name = str(raw.get("LastName") or "").strip() or None

    return {
        "name": name,
        "abn": tax_number,
        "contact_first_name": contact_first_name,
        "contact_last_name": contact_last_name,
        "email_address": email_address,
        "contact_phone": contact_phone,
        "phones": phones,
        "status": _status_from_xero(raw),
        "brand_code": brand_code_from_xero_branding_theme(raw),
        "xero_last_modified": parse_xero_updated_date_utc(raw.get("UpdatedDateUTC")),
        "contacts": contacts_from_xero_contact(raw),
        "delivery_addresses": delivery_addresses_from_xero_contact(raw),
    }