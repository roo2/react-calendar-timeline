"""Customer delivery address helpers (display + Xero export)."""

from __future__ import annotations

from typing import Any


def delivery_addresses_from_customer(customer: Any) -> list[dict[str, Any]]:
    raw = getattr(customer, "delivery_addresses", None)
    if isinstance(raw, dict):
        items = raw.get("items")
        if isinstance(items, list):
            return [a for a in items if isinstance(a, dict)]
    if isinstance(raw, list):
        return [a for a in raw if isinstance(a, dict)]
    return []


def pick_default_delivery_address(addresses: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Prefer default delivery/both address; fall back to first usable row."""
    candidates: list[dict[str, Any]] = []
    for addr in addresses:
        addr_type = str(addr.get("type") or "").strip()
        if addr_type in ("Delivery", "Both", ""):
            candidates.append(addr)
    if not candidates:
        candidates = list(addresses)
    for addr in candidates:
        if bool(addr.get("is_default")) and _address_has_content(addr):
            return addr
    for addr in candidates:
        if _address_has_content(addr):
            return addr
    return None


def _address_has_content(addr: dict[str, Any]) -> bool:
    parts = (
        addr.get("street1"),
        addr.get("street2"),
        addr.get("suburb"),
        addr.get("state"),
        addr.get("postcode"),
        addr.get("country"),
    )
    return any(str(p or "").strip() for p in parts)


def format_delivery_address_display(addr: dict[str, Any] | None) -> str | None:
    if not addr or not _address_has_content(addr):
        return None
    lines: list[str] = []
    street = "\n".join(p for p in (str(addr.get("street1") or "").strip(), str(addr.get("street2") or "").strip()) if p)
    if street:
        lines.append(street)
    locality = " ".join(
        p
        for p in (
            str(addr.get("suburb") or "").strip(),
            str(addr.get("state") or "").strip(),
            str(addr.get("postcode") or "").strip(),
        )
        if p
    )
    if locality:
        lines.append(locality)
    country = str(addr.get("country") or "").strip()
    if country:
        lines.append(country)
    contact_name = str(addr.get("contact_name") or "").strip()
    contact_phone = str(addr.get("contact_phone") or "").strip()
    if contact_name or contact_phone:
        contact = contact_name
        if contact_phone:
            contact = f"{contact} — {contact_phone}" if contact else contact_phone
        lines.append(f"Contact: {contact}")
    instructions = str(addr.get("delivery_instructions") or "").strip()
    if instructions:
        lines.append(f"Instructions: {instructions}")
    label = str(addr.get("label") or "").strip()
    if label and len(lines) > 0:
        return f"{label}\n" + "\n".join(lines)
    return "\n".join(lines) if lines else None


def customer_default_delivery_address_display(customer: Any) -> str | None:
    return format_delivery_address_display(
        pick_default_delivery_address(delivery_addresses_from_customer(customer))
    )


def customer_address_to_xero_addresses(addr: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Map app delivery address to Xero contact Addresses.

    Xero invoices default to the contact POBOX address; set both STREET and POBOX so delivery
    details appear on exported invoices.
    """
    if not _address_has_content(addr):
        return []

    line1 = str(addr.get("street1") or "").strip()
    line2 = str(addr.get("street2") or "").strip()
    city = str(addr.get("suburb") or "").strip()
    region = str(addr.get("state") or "").strip()
    postal = str(addr.get("postcode") or "").strip()
    country = str(addr.get("country") or "").strip()
    attention = str(addr.get("contact_name") or "").strip()

    def build(address_type: str) -> dict[str, str]:
        out: dict[str, str] = {"AddressType": address_type}
        if line1:
            out["AddressLine1"] = line1[:500]
        if line2:
            out["AddressLine2"] = line2[:500]
        if city:
            out["City"] = city[:255]
        if region:
            out["Region"] = region[:255]
        if postal:
            out["PostalCode"] = postal[:50]
        if country:
            out["Country"] = country[:50]
        if attention:
            out["AttentionTo"] = attention[:255]
        return out

    return [build("STREET"), build("POBOX")]
