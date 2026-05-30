"""Unit tests for Xero ↔ app customer name matching helpers."""

from __future__ import annotations

from app.integrations.xero.service import (
    _imported_customer_name_key,
    _normalize_match_text,
    _xero_imported_name_lookup_key,
)


def test_imported_name_key_only_for_names_up_to_25_chars():
    short = "Some Long Company Name"
    assert len(short) == 22
    assert _imported_customer_name_key(short) == _normalize_match_text(short)
    assert _imported_customer_name_key("") == ""
    assert _imported_customer_name_key("A" * 26) == ""


def test_xero_lookup_uses_first_25_chars_of_full_name():
    app_name = "Some Long Company Nam"  # 25 chars, legacy import trim
    xero_name = "Some Long Company Name Pty Ltd"
    assert _imported_customer_name_key(app_name) == _xero_imported_name_lookup_key(xero_name)


def test_exact_normalized_name_still_matches_when_under_25_chars():
    name = "ABC Powdercoaters"
    assert _imported_customer_name_key(name) == _normalize_match_text(name)
    assert _xero_imported_name_lookup_key(name) == _normalize_match_text(name)
