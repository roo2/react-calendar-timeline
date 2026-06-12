"""Unit tests for customer delivery address helpers."""

from __future__ import annotations

from app.customers.contact_address import format_address_display, pick_default_delivery_address
from app.customers.delivery_address import customer_address_to_xero_addresses


def test_pick_default_delivery_address_prefers_street():
    addresses = [
        {"address_type": "POBOX", "address_line1": "PO Box 1", "city": "Brisbane"},
        {"address_type": "STREET", "address_line1": "2 New St", "city": "Sydney"},
    ]
    picked = pick_default_delivery_address(addresses)
    assert picked is not None
    assert picked["address_line1"] == "2 New St"


def test_format_delivery_address_display_multiline():
    text = format_address_display(
        {
            "address_line1": "11 Bent Street",
            "city": "Gympie",
            "region": "QLD",
            "postal_code": "4570",
        }
    )
    assert text is not None
    assert "11 Bent Street" in text
    assert "Gympie QLD 4570" in text


def test_pick_default_delivery_address_prefers_street_over_pobox():
    addresses = [
        {"address_type": "POBOX", "address_line1": "P O BOX 238", "city": "Buddina"},
        {"address_type": "STREET", "address_line1": "11 Bent Street", "city": "Gympie"},
    ]
    picked = pick_default_delivery_address(addresses)
    assert picked is not None
    assert picked["address_line1"] == "11 Bent Street"


def test_customer_address_to_xero_addresses_sets_street_and_pobox():
    rows = customer_address_to_xero_addresses(
        {
            "address_type": "STREET",
            "address_line1": "11 Bent Street",
            "city": "Gympie",
            "region": "QLD",
            "postal_code": "4570",
            "attention_to": "Jason",
        }
    )
    assert len(rows) == 2
    assert rows[0]["AddressType"] == "STREET"
    assert rows[1]["AddressType"] == "POBOX"
    assert rows[0]["AddressLine1"] == "11 Bent Street"
    assert rows[0]["AttentionTo"] == "Jason"
