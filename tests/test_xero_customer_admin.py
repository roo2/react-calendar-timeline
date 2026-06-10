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
        }
    ) is None


def test_customer_not_deletable_with_orders_or_quotes():
    assert _customer_deletable_reason({"orders_count": 1, "quotes_count": 0}) == "has_orders"
    assert _customer_deletable_reason({"orders_count": 0, "quotes_count": 2}) == "has_quotes"


def test_customer_not_deletable_with_products_or_job_sheets():
    assert _customer_deletable_reason({"products_count": 1}) == "has_products"
    assert _customer_deletable_reason({"job_sheets_count": 1}) == "has_job_sheets"


def test_manual_link_rejects_invalid_contact_uuid():
    from app.integrations.xero.service import manual_link_xero_customer

    db = MagicMock()
    try:
        manual_link_xero_customer(db, customer_id="cust-1", contact_id="not-a-uuid")
        assert False, "expected XeroConfigError"
    except Exception as e:
        assert "GUID" in str(e)
