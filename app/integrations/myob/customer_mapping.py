"""
Pure MYOB Contact/Customer → Production JSON field mapping (no DB side effects).

Used by customer_import and unit tests.

Some individual cards store the trading/company name in ``LastName`` with a ``"D - "``
prefix (e.g. ``LastName``: ``"D - DANIEL ST FISH MARKET"``, ``FirstName``: ``"JANINE"``).
When ``IsIndividual`` is true and that pattern matches, we use the suffix as the company
name and the first name as the primary contact person.

Some company cards (``IsIndividual`` false) put the same ``D - `` prefix on ``CompanyName``;
that prefix is stripped from the stored company display name.

On import, those ``D -`` customers are linked to the Dolphin brand; see
``myob_raw_indicates_dolphin_brand``.
"""

from __future__ import annotations

import html
import re
from datetime import UTC, datetime
from typing import Any

# Individual cards: company name sometimes stored as "D - <COMPANY>" in LastName.
_D_TRADING_AS_COMPANY_PREFIX = re.compile(r"^\s*D\s*-\s*", re.IGNORECASE)


def decode_myob_text(value: Any) -> str:
    """MYOB sometimes returns HTML entities in strings (e.g. &amp;)."""
    if value is None:
        return ""
    s = str(value).strip()
    if not s:
        return ""
    return html.unescape(s)


def individual_trading_as_company_lastname(raw: dict[str, Any]) -> str | None:
    """
    When ``IsIndividual`` is true and ``LastName`` starts with ``D - `` (case-insensitive),
    return the remainder as the business/trading name (e.g. ``D - DANIEL ST FISH MARKET``
    → ``DANIEL ST FISH MARKET``). Otherwise ``None``.
    """
    if raw.get("IsIndividual") is not True:
        return None
    last = decode_myob_text(raw.get("LastName"))
    if not last:
        return None
    m = _D_TRADING_AS_COMPANY_PREFIX.match(last)
    if not m:
        return None
    tail = last[m.end() :].strip()
    return tail or None


def strip_leading_d_trading_prefix_from_display_name(s: str) -> str:
    """
    Strip a leading ``D -`` trading prefix from a display name (case-insensitive), when the
    remainder is non-empty. Used for ``CompanyName`` and for individual LastName tails.
    """
    if not (s or "").strip():
        return s
    m = _D_TRADING_AS_COMPANY_PREFIX.match(s)
    if not m:
        return s
    tail = s[m.end() :].strip()
    return tail if tail else s


def company_name_from_myob(raw: dict[str, Any]) -> str:
    """
    Decoded customer display name for import.

    Prefer company / individual trading name; when ``CompanyName`` is empty, fall back to the
    first address ``ContactName`` (same source as the primary contact person).
    """
    trading = individual_trading_as_company_lastname(raw)
    if trading:
        return strip_leading_d_trading_prefix_from_display_name(trading)
    base = decode_myob_text(raw.get("CompanyName"))
    base = strip_leading_d_trading_prefix_from_display_name(base)
    if base:
        return base
    person = primary_contact_person_name_from_myob(raw)
    if person:
        return person
    return ""


def myob_raw_indicates_dolphin_brand(raw: dict[str, Any]) -> bool:
    """
    Return True when MYOB data should be linked to the **Dolphin** brand on import:

    - **Individual** (``IsIndividual`` is true) and ``LastName`` has the leading ``D - <company>``
      pattern (same rule as :func:`individual_trading_as_company_lastname`); or
    - **Company** (``IsIndividual`` is not true) and ``CompanyName`` has a leading
      ``D -`` prefix (case-insensitive, same regex as other ``D -`` rules).
    """
    if raw.get("IsIndividual") is True:
        return individual_trading_as_company_lastname(raw) is not None
    cn = decode_myob_text(raw.get("CompanyName"))
    if not cn:
        return False
    return _D_TRADING_AS_COMPANY_PREFIX.match(cn) is not None


def parse_myob_last_modified(value: Any) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt
    except ValueError:
        return None


def _norm_abn(value: Any) -> str | None:
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value).strip())
    return s or None


def status_from_myob(raw: dict[str, Any]) -> str:
    if raw.get("IsActive") is False:
        return "Inactive"
    sd = raw.get("SellingDetails") if isinstance(raw.get("SellingDetails"), dict) else {}
    credit = sd.get("Credit") if isinstance(sd.get("Credit"), dict) else {}
    if credit.get("OnHold") is True:
        return "Inactive"
    return "Active"


def primary_phone_from_myob(raw: dict[str, Any]) -> str | None:
    addrs = raw.get("Addresses")
    if not isinstance(addrs, list):
        return None
    for a in addrs:
        if not isinstance(a, dict):
            continue
        for key in ("Phone1", "Phone2", "Phone3"):
            p = a.get(key)
            if isinstance(p, str) and p.strip():
                return p.strip()[:50]
    return None


def primary_contact_person_name_from_myob(raw: dict[str, Any]) -> str | None:
    """First non-empty MYOB address ContactName (e.g. primary site contact)."""
    addrs = raw.get("Addresses")
    if not isinstance(addrs, list):
        return None
    for a in addrs:
        if not isinstance(a, dict):
            continue
        cn = a.get("ContactName")
        if isinstance(cn, str) and cn.strip():
            return cn.strip()[:255]
    return None


def first_email_from_myob_addresses(raw: dict[str, Any]) -> str | None:
    addrs = raw.get("Addresses")
    if not isinstance(addrs, list):
        return None
    for a in addrs:
        if not isinstance(a, dict):
            continue
        em = a.get("Email")
        if isinstance(em, str) and em.strip():
            return em.strip()[:255]
    return None


def _split_street(street: str) -> tuple[str | None, str | None]:
    s = (street or "").replace("\r\n", "\n").strip()
    if not s:
        return (None, None)
    parts = [p.strip() for p in s.split("\n") if p.strip()]
    if not parts:
        return (None, None)
    if len(parts) == 1:
        return (parts[0], None)
    return (parts[0], "\n".join(parts[1:]))


def _myob_address_row_has_location_content(a: dict[str, Any]) -> bool:
    """True when MYOB address row has postal/street location data (not email/phone-only slots)."""
    st = a.get("Street")
    if isinstance(st, str) and st.strip():
        return True
    for key in ("City", "State", "PostCode", "Country"):
        v = a.get(key)
        if isinstance(v, str) and v.strip():
            return True
    return False


def _address_row_has_content(a: dict[str, Any]) -> bool:
    """True when a MYOB address row has any usable content (used for contact discovery)."""
    if _myob_address_row_has_location_content(a):
        return True
    for key in ("Phone1", "Phone2", "Phone3", "Email", "ContactName"):
        v = a.get(key)
        if isinstance(v, str) and v.strip():
            return True
    return False


def _is_po_box_street(street: str) -> bool:
    """Heuristic for MYOB postal/bill-to rows stored in the Street field."""
    s = re.sub(r"[^A-Z0-9]", " ", (street or "").upper())
    return bool(re.search(r"\bP O BOX\b|\bPO BOX\b|\bPOBOX\b|\bPOST OFFICE BOX\b", s))


def _myob_address_location(a: dict[str, Any]) -> int | None:
    loc = a.get("Location")
    if isinstance(loc, int) and loc >= 1:
        return loc
    if isinstance(loc, str) and loc.strip().isdigit():
        return int(loc.strip())
    return None


def _myob_address_type(
    a: dict[str, Any],
    *,
    index: int,
    kept_rows: list[dict[str, Any]],
) -> str:
    """
    Map MYOB AccountRight address slots to app address types.

    Location 1 is the bill-to/postal address; locations 2–5 are ship-to/delivery addresses.
    When only one filled address exists, treat it as Both unless it is PO Box only.
    """
    street = str(a.get("Street") or "")

    if len(kept_rows) == 1:
        if _is_po_box_street(street):
            return "Billing"
        return "Both"

    locations = {_myob_address_location(row) for row in kept_rows}
    locations.discard(None)
    loc = _myob_address_location(a)

    if loc is not None:
        if loc >= 2:
            return "Delivery"
        if locations & {2, 3, 4, 5}:
            return "Billing"
        if _is_po_box_street(street):
            return "Billing"
        return "Both"

    if index == 0:
        return "Billing"
    return "Delivery"


def _myob_address_can_be_default_delivery(addr_type: str) -> bool:
    return addr_type in ("Delivery", "Both")


def build_delivery_addresses_from_myob(raw: dict[str, Any]) -> dict[str, Any]:
    """
    Map MYOB customer address rows into app delivery/billing address items.

    Only include address rows with actual location data (street/suburb/state/postcode/country).
    Email-only or phone-only MYOB slots are skipped; contact fields are still synced via contacts.
    Omitted optional fields are not set on the dict (frontend treats missing as empty).
    """
    items: list[dict[str, Any]] = []
    addrs = raw.get("Addresses")
    kept_rows: list[dict[str, Any]] = []
    if isinstance(addrs, list):
        for a in addrs:
            if isinstance(a, dict) and _myob_address_row_has_location_content(a):
                kept_rows.append(a)

    default_delivery_set = False
    for i, a in enumerate(kept_rows):
        st = a.get("Street")
        street = st if isinstance(st, str) else ""
        street1, street2 = _split_street(street)
        city = (a.get("City") or "").strip()
        state = (a.get("State") or "").strip()
        pc = (a.get("PostCode") or "").strip()
        country = (a.get("Country") or "").strip()
        addr_type = _myob_address_type(a, index=i, kept_rows=kept_rows)
        row: dict[str, Any] = {
            "type": addr_type,
            "is_default": False,
        }
        if _myob_address_can_be_default_delivery(addr_type) and not default_delivery_set:
            row["is_default"] = True
            default_delivery_set = True
        if street1:
            row["street1"] = street1
        if street2:
            row["street2"] = street2
        if city:
            row["suburb"] = city
        if state:
            row["state"] = state
        if pc:
            row["postcode"] = pc
        if country:
            row["country"] = country
        cn = (a.get("ContactName") or "").strip()
        if cn:
            row["contact_name"] = cn
        ph = (a.get("Phone1") or "").strip()
        if ph:
            row["contact_phone"] = ph[:50]
        items.append(row)

    return {"items": items}


def build_contacts_from_myob(raw: dict[str, Any], *, myob_uid: str, company_display_name: str) -> dict[str, Any]:
    """
    Primary contact: person name from MYOB ContactName when present, else company name.

    For individuals with ``LastName`` in the ``D - <company>`` convention, the primary
    contact name is taken from ``FirstName`` when set (see module docstring).
    """
    person: str | None = None
    if individual_trading_as_company_lastname(raw) is not None:
        fn = decode_myob_text(raw.get("FirstName"))
        if fn:
            person = fn[:255]
    if person is None:
        person = primary_contact_person_name_from_myob(raw)
    display_name = person or company_display_name
    contact: dict[str, Any] = {
        "type": "Primary Contact",
        "name": display_name,
    }
    em = first_email_from_myob_addresses(raw)
    if em:
        contact["email"] = em
    ph = primary_phone_from_myob(raw)
    if ph:
        contact["phone"] = ph
    # myob_uid unused for synthetic email anymore — keep param for API stability / future use
    _ = myob_uid
    return {"items": [contact]}


def abn_from_myob(raw: dict[str, Any]) -> str | None:
    sd = raw.get("SellingDetails") if isinstance(raw.get("SellingDetails"), dict) else {}
    return _norm_abn(sd.get("ABN"))


def decode_myob_notes_newlines(s: str) -> str:
    """
    MYOB sometimes returns line breaks as literal two-character sequences (backslash + n),
    which would otherwise display as '\\n' in the UI.
    """
    if not s:
        return s
    return s.replace("\\r\\n", "\n").replace("\\r", "\n").replace("\\n", "\n")


def myob_notes_from_raw(raw: dict[str, Any]) -> str | None:
    notes = raw.get("Notes")
    if notes is None:
        return None
    s = str(notes)
    if not s.strip():
        return None
    s = html.unescape(s)
    s = decode_myob_notes_newlines(s).strip()
    return s or None


def _coerce_int(v: Any) -> int | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        if not v == v:  # NaN
            return None
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return int(s)
        except ValueError:
            return None
    return None


def payment_terms_dict_from_myob(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    Map MYOB AccountRight SellingDetails.Terms to our stored JSON shape (snake_case keys).

    Stores ``payment_is_due`` and ``balance_due_date`` only (we do not persist MYOB
    ``DiscountDate``).
    """
    sd = raw.get("SellingDetails") if isinstance(raw.get("SellingDetails"), dict) else {}
    terms = sd.get("Terms")
    if not isinstance(terms, dict):
        return None
    pid = terms.get("PaymentIsDue")
    if not isinstance(pid, str) or not pid.strip():
        return None
    pid = pid.strip()
    if pid not in (
        "CashOnDelivery",
        "PrePaid",
        "InAGivenNumberOfDays",
        "OnADayOfTheMonth",
        "NumberOfDaysAfterEOM",
        "DayOfMonthAfterEOM",
    ):
        return None
    balance_due = _coerce_int(terms.get("BalanceDueDate"))

    if pid == "InAGivenNumberOfDays":
        if balance_due is None or balance_due < 1:
            return None
    if pid == "OnADayOfTheMonth":
        if balance_due is None or not (1 <= balance_due <= 31):
            return None
    if pid == "NumberOfDaysAfterEOM":
        if balance_due is None or balance_due < 1:
            return None
    if pid == "DayOfMonthAfterEOM":
        if balance_due is None or not (1 <= balance_due <= 31):
            return None

    out: dict[str, Any] = {"payment_is_due": pid}
    if balance_due is not None:
        out["balance_due_date"] = balance_due
    return out
