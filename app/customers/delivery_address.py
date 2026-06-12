"""Customer delivery address helpers (display + Xero export)."""

from __future__ import annotations

from typing import Any

from app.customers.contact_address import (
    address_has_content,
    address_to_xero_api_addresses,
    format_address_display,
    normalize_address_item,
    normalize_delivery_addresses,
    pick_default_delivery_address,
)


def delivery_addresses_from_customer(customer: Any) -> list[dict[str, Any]]:
    raw = getattr(customer, "delivery_addresses", None)
    if isinstance(raw, dict):
        items = raw.get("items")
        if isinstance(items, list):
            return normalize_delivery_addresses({"items": items})["items"]
    if isinstance(raw, list):
        return normalize_delivery_addresses(raw)["items"]
    return []


def customer_default_delivery_address_display(customer: Any) -> str | None:
    return format_address_display(pick_default_delivery_address(delivery_addresses_from_customer(customer)))


def customer_address_to_xero_addresses(addr: dict[str, Any]) -> list[dict[str, Any]]:
    return address_to_xero_api_addresses(addr)


__all__ = [
    "address_has_content",
    "customer_address_to_xero_addresses",
    "customer_default_delivery_address_display",
    "delivery_addresses_from_customer",
    "format_address_display",
    "normalize_address_item",
    "normalize_delivery_addresses",
    "pick_default_delivery_address",
]
