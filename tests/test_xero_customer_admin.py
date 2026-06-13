"""Unit tests for Xero customer admin helpers (manual link / delete preview)."""

from __future__ import annotations

from unittest.mock import MagicMock

from app.integrations.xero.service import _customer_deletable_reason


def test_customer_deletable_when_no_activity():
    assert _customer_deletable_reason(
        {
            "orders_count": 0,
            "quotes_count": 0,
            "products_count": 0,
            "job_sheets_count": 0,
            "plates_count": 0,
        }
    ) is None


def test_customer_not_deletable_with_orders_or_quotes():
    assert _customer_deletable_reason({"orders_count": 1, "quotes_count": 0}) == "has_orders"
    assert _customer_deletable_reason({"orders_count": 0, "quotes_count": 2}) == "has_quotes"


def test_customer_not_deletable_with_products_or_job_sheets():
    assert _customer_deletable_reason({"products_count": 1}) == "has_products"
    assert _customer_deletable_reason({"job_sheets_count": 1}) == "has_job_sheets"
    assert _customer_deletable_reason({"plates_count": 1}) == "has_plates"


def test_xero_primary_address_prefers_street():
    from app.integrations.xero.service import _xero_primary_address_display

    raw = {
        "Addresses": [
            {"AddressType": "POBOX", "AddressLine1": "PO Box 1", "City": "Brisbane"},
            {"AddressType": "STREET", "AddressLine1": "11 Bent Street", "City": "Gympie", "PostalCode": "4570"},
        ]
    }
    text = _xero_primary_address_display(raw)
    assert text is not None
    assert "11 Bent Street" in text
    assert "Gympie" in text


def test_manual_link_rejects_invalid_contact_uuid():
    from app.integrations.xero.service import manual_link_xero_customer

    db = MagicMock()
    try:
        manual_link_xero_customer(db, customer_id="cust-1", contact_id="not-a-uuid")
        assert False, "expected XeroConfigError"
    except Exception as e:
        assert "GUID" in str(e)

