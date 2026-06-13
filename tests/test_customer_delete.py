"""Unit tests for customer delete guards."""

from __future__ import annotations

from unittest.mock import patch

from app.customers.service import customer_delete_block_reason, customer_can_delete
from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID


def test_draft_internal_customer_not_deletable():
    assert customer_delete_block_reason(MYOB_DRAFT_INTERNAL_CUSTOMER_ID) == "system_placeholder"
    assert customer_can_delete(MYOB_DRAFT_INTERNAL_CUSTOMER_ID) is False


@patch("app.customers.service.get_customer_quotes_count", return_value=0)
@patch("app.customers.service.get_customer_orders_count", return_value=2)
def test_customer_with_orders_not_deletable(_mock_quotes, _mock_orders):
    assert customer_delete_block_reason("cust-1") == "has_orders"
    assert customer_can_delete("cust-1") is False


@patch("app.customers.service.get_customer_quotes_count", return_value=1)
@patch("app.customers.service.get_customer_orders_count", return_value=0)
def test_customer_with_quotes_not_deletable(_mock_quotes, _mock_orders):
    assert customer_delete_block_reason("cust-1") == "has_quotes"
    assert customer_can_delete("cust-1") is False


@patch("app.customers.service.get_customer_quotes_count", return_value=0)
@patch("app.customers.service.get_customer_orders_count", return_value=0)
def test_customer_without_orders_or_quotes_deletable(_mock_quotes, _mock_orders):
    assert customer_delete_block_reason("cust-1") is None
    assert customer_can_delete("cust-1") is True
