"""Unit tests for customer delivery address helpers."""

from __future__ import annotations

from app.customers.delivery_address import (
    customer_address_to_xero_addresses,
    format_delivery_address_display,
    pick_default_delivery_address,
)


def test_pick_default_delivery_address_prefers_default_flag():
    addresses = [
        {"type": "Delivery", "street1": "1 Old St", "suburb": "Brisbane", "is_default": False},
        {"type": "Delivery", "street1": "2 New St", "suburb": "Sydney", "is_default": True},
    ]
    picked = pick_default_delivery_address(addresses)
    assert picked is not None
    assert picked["street1"] == "2 New St"


def test_format_delivery_address_display_multiline():
    text = format_delivery_address_display(
        {
            "label": "Warehouse",
            "street1": "11 Bent Street",
            "suburb": "Gympie",
            "state": "QLD",
            "postcode": "4570",
        }
    )
    assert text is not None
    assert "Warehouse" in text
    assert "11 Bent Street" in text
    assert "Gympie QLD 4570" in text


def test_pick_default_delivery_address_skips_billing_only_postal():
    addresses = [
        {"type": "Billing", "street1": "P O BOX 238", "suburb": "Buddina", "is_default": False},
        {"type": "Delivery", "street1": "11 Bent Street", "suburb": "Gympie", "is_default": True},
    ]
    picked = pick_default_delivery_address(addresses)
    assert picked is not None
    assert picked["street1"] == "11 Bent Street"


def test_customer_address_to_xero_addresses_sets_street_and_pobox():
    rows = customer_address_to_xero_addresses(
        {
            "street1": "11 Bent Street",
            "suburb": "Gympie",
            "state": "QLD",
            "postcode": "4570",
            "contact_name": "Jason",
        }
    )
    assert len(rows) == 2
    assert rows[0]["AddressType"] == "STREET"
    assert rows[1]["AddressType"] == "POBOX"
    assert rows[0]["AddressLine1"] == "11 Bent Street"
    assert rows[0]["AttentionTo"] == "Jason"
