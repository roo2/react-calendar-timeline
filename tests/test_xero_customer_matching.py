"""Unit tests for Xero ↔ app customer name matching helpers."""

from __future__ import annotations

from types import SimpleNamespace

from app.integrations.xero.service import (
    TRUNCATED_APP_NAME_MAX_LEN,
    _imported_customer_name_key,
    _legacy_truncated_app_name_norm,
    _normalize_match_text,
    _unique_truncated_name_prefix_match,
    _xero_imported_name_lookup_key,
)


def test_imported_name_key_only_for_names_up_to_25_chars():
    short = "Some Long Company Name"
    assert len(short) == 22
    assert _imported_customer_name_key(short) == _normalize_match_text(short)
    assert _imported_customer_name_key("") == ""
    assert _imported_customer_name_key("A" * 26) == ""


def test_legacy_truncated_name_norm_allows_slight_overrun():
    name = "HINTERLAND COMMERCIAL LAUN"
    assert len(name) == 26
    assert len(name) <= TRUNCATED_APP_NAME_MAX_LEN
    assert _legacy_truncated_app_name_norm(name) == _normalize_match_text(name)


def test_truncated_prefix_match_legacy_25_char_import():
    app_name = "Some Long Company Nam"  # 25 chars, legacy import trim
    xero_name = "Some Long Company Name Pty Ltd"
    customers = [SimpleNamespace(id="c1", name=app_name)]
    match = _unique_truncated_name_prefix_match(customers, xero_name)
    assert match is not None
    assert match.id == "c1"
    assert _xero_imported_name_lookup_key(xero_name) == _normalize_match_text(
        xero_name[:25]
    )


def test_exact_normalized_name_still_matches_when_under_25_chars():
    name = "ABC Powdercoaters"
    assert _imported_customer_name_key(name) == _normalize_match_text(name)
    assert _xero_imported_name_lookup_key(name) == _normalize_match_text(name)


def test_truncated_prefix_match_hinterland_example():
    app_name = "HINTERLAND COMMERCIAL LAUN"
    xero_name = "HINTERLAND COMMERCIAL LAUNDRY"
    customers = [SimpleNamespace(id="c1", name=app_name)]
    match = _unique_truncated_name_prefix_match(customers, xero_name)
    assert match is not None
    assert match.id == "c1"


def test_truncated_prefix_match_requires_unique_app_customer():
    xero_name = "HINTERLAND COMMERCIAL LAUNDRY"
    customers = [
        SimpleNamespace(id="c1", name="HINTERLAND COMMERCIAL LAUN"),
        SimpleNamespace(id="c2", name="HINTERLAND COMMERCIAL LAUND"),
    ]
    assert _unique_truncated_name_prefix_match(customers, xero_name) is None
