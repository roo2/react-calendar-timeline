"""Unit tests for customer phone normalization and Xero mapping."""

from __future__ import annotations

from app.customers.contact_address import (
    app_phones_to_xero_phones,
    format_phone_display,
    normalize_phones,
    phones_from_xero_list,
    primary_phone_display,
)
from app.integrations.xero.customer_mapping import (
    customer_fields_from_xero_contact,
    customer_to_xero_contact_update_body,
)


def test_normalize_phones_from_legacy_contact_phone():
    phones = normalize_phones(None, contact_phone="07 1234 5678")
    assert len(phones["items"]) == 1
    assert phones["items"][0]["phone_type"] == "DEFAULT"
    assert phones["items"][0]["phone_area_code"] == "07"
    assert phones["items"][0]["phone_number"] == "1234 5678"
    assert primary_phone_display(phones) == "07 1234 5678"


def test_app_phones_to_xero_phones_multiple_types():
    rows = app_phones_to_xero_phones(
        {
            "items": [
                {"phone_type": "DEFAULT", "phone_area_code": "07", "phone_number": "1234 5678"},
                {"phone_type": "MOBILE", "phone_number": "0412 345 678"},
            ]
        }
    )
    assert len(rows) == 2
    assert rows[0]["PhoneType"] == "DEFAULT"
    assert rows[1]["PhoneType"] == "MOBILE"


def test_phones_from_xero_list_round_trip():
    raw = {
        "Name": "Acme Pty Ltd",
        "Phones": [
            {"PhoneType": "DEFAULT", "PhoneAreaCode": "07", "PhoneNumber": "12345678"},
            {"PhoneType": "FAX", "PhoneNumber": "12345679"},
        ]
    }
    phones = phones_from_xero_list(raw["Phones"])
    assert len(phones["items"]) == 2
    assert format_phone_display(phones["items"][0]) == "07 12345678"
    mapped = customer_fields_from_xero_contact(raw)
    assert mapped["contact_phone"] == "07 12345678"
    assert len(mapped["phones"]["items"]) == 2


def test_customer_to_xero_contact_update_body_uses_phones_json():
    body = customer_to_xero_contact_update_body(
        contact_id="550e8400-e29b-41d4-a716-446655440000",
        name="Acme Pty Ltd",
        phones={
            "items": [
                {"phone_type": "DEFAULT", "phone_area_code": "07", "phone_number": "1234 5678"},
                {"phone_type": "MOBILE", "phone_number": "0412 345 678"},
            ]
        },
    )
    assert len(body["Phones"]) == 2
    assert body["Phones"][1]["PhoneType"] == "MOBILE"
