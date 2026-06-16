"""Unit tests for Xero contact → app customer mapping."""

from __future__ import annotations

from datetime import UTC, datetime

from app.customers.contact_address import parse_xero_updated_date_utc
from app.integrations.xero.customer_mapping import (
    APPROVED_PACKAGING_BRAND_CODE,
    CROWN_PACK_BRAND_CODE,
    DOLPHIN_BRAND_CODE,
    app_contacts_to_xero_contact_persons,
    app_delivery_addresses_to_xero_addresses,
    brand_code_from_xero_branding_theme,
    branding_theme_match_needles,
    contacts_from_xero_contact,
    customer_fields_from_xero_contact,
    customer_to_xero_contact_create_body,
    customer_to_xero_contact_update_body,
    delivery_addresses_from_xero_contact,
    merge_customer_fields_from_app_and_xero,
    phone_to_xero_phones,
    pick_xero_branding_theme_id_from_list,
    status_to_xero,
)


def test_parse_xero_updated_date_utc():
    dt = parse_xero_updated_date_utc("/Date(1779930270423+0000)/")
    assert dt is not None
    assert dt.tzinfo is UTC


def test_delivery_addresses_keep_xero_lines_and_attention():
    raw = {
        "Addresses": [
            {
                "AddressType": "STREET",
                "AddressLine1": "MARKS ROAD",
                "AddressLine2": "WOONGOOLBA  QLD  4027",
            },
            {
                "AddressType": "POBOX",
                "AddressLine1": "MARKS ROAD",
                "AddressLine2": "WOONGOOLBA  QLD  4027",
                "AddressLine3": "FAX: 5546 1492",
                "AttentionTo": "DEBBIE/DIANE",
            },
        ]
    }
    items = delivery_addresses_from_xero_contact(raw)["items"]
    assert len(items) == 2
    assert items[0]["address_type"] == "STREET"
    assert items[0]["address_line1"] == "MARKS ROAD"
    assert items[1]["address_type"] == "POBOX"
    assert items[1]["address_line3"] == "FAX: 5546 1492"
    assert items[1]["attention_to"] == "DEBBIE/DIANE"


def test_contacts_map_contact_persons_only():
    raw = {
        "Name": "100% REEF SAFE",
        "EmailAddress": "jane@example.com",
        "Phones": [{"PhoneType": "DEFAULT", "PhoneAreaCode": "07", "PhoneNumber": "12345678"}],
        "ContactPersons": [
            {
                "FirstName": "Bob",
                "LastName": "Jones",
                "EmailAddress": "bob@example.com",
                "IncludeInEmails": True,
            }
        ],
    }
    items = contacts_from_xero_contact(raw)["items"]
    assert len(items) == 1
    assert items[0]["first_name"] == "Bob"
    assert items[0]["last_name"] == "Jones"
    assert items[0]["email_address"] == "bob@example.com"


def test_customer_fields_from_xero_contact():
    raw = {
        "Name": "Acme Pty Ltd",
        "FirstName": "Jane",
        "LastName": "Smith",
        "TaxNumber": "12345678901",
        "ContactStatus": "ACTIVE",
        "EmailAddress": "accounts@acme.example",
        "UpdatedDateUTC": "/Date(1779930270423+0000)/",
        "Phones": [{"PhoneType": "MOBILE", "PhoneNumber": "0400000000"}],
        "BrandingTheme": {"Name": "Approved Packaging"},
        "Addresses": [
            {
                "AddressType": "STREET",
                "AddressLine1": "1 Main St",
                "City": "Sydney",
                "Region": "NSW",
                "PostalCode": "2000",
            }
        ],
    }
    mapped = customer_fields_from_xero_contact(raw)
    assert mapped["name"] == "Acme Pty Ltd"
    assert mapped["contact_first_name"] == "Jane"
    assert mapped["contact_last_name"] == "Smith"
    assert mapped["abn"] == "12345678901"
    assert mapped["email_address"] == "accounts@acme.example"
    assert mapped["contact_phone"] == "0400000000"
    assert mapped["status"] == "Active"
    assert mapped["brand_code"] == APPROVED_PACKAGING_BRAND_CODE
    assert isinstance(mapped["xero_last_modified"], datetime)
    assert len(mapped["delivery_addresses"]["items"]) == 1


def test_status_to_xero_and_phone_mapping():
    assert status_to_xero("Archived") == "ARCHIVED"
    assert status_to_xero("Inactive") == "INACTIVE"
    assert status_to_xero("Active") == "ACTIVE"
    assert phone_to_xero_phones("5546 1361") == [
        {"PhoneType": "DEFAULT", "PhoneAreaCode": "5546", "PhoneNumber": "1361"}
    ]


def test_app_to_xero_address_and_contact_mapping():
    addresses = app_delivery_addresses_to_xero_addresses(
        {
            "items": [
                {
                    "address_type": "POBOX",
                    "address_line1": "PO BOX 1",
                    "city": "Brisbane",
                    "region": "QLD",
                    "postal_code": "4000",
                    "attention_to": "Accounts",
                },
                {
                    "address_type": "STREET",
                    "address_line1": "9 Test Road",
                    "city": "Townsville",
                    "region": "QLD",
                    "postal_code": "4810",
                },
            ]
        }
    )
    assert len(addresses) == 2
    assert addresses[0]["AddressType"] == "STREET"
    assert addresses[0]["AddressLine1"] == "9 Test Road"
    assert addresses[1]["AddressType"] == "POBOX"
    assert addresses[1]["AttentionTo"] == "Accounts"

    persons = app_contacts_to_xero_contact_persons(
        {
            "items": [
                {
                    "first_name": "Bob",
                    "last_name": "Jones",
                    "email_address": "bob@example.com",
                    "include_in_emails": True,
                }
            ]
        }
    )
    assert persons == [
        {
            "FirstName": "Bob",
            "LastName": "Jones",
            "IncludeInEmails": True,
            "EmailAddress": "bob@example.com",
        }
    ]


def test_customer_to_xero_contact_update_body():
    body = customer_to_xero_contact_update_body(
        contact_id="550e8400-e29b-41d4-a716-446655440000",
        name="Acme Pty Ltd",
        abn="12345678901",
        contact_first_name="Jane",
        contact_last_name="Smith",
        email_address="accounts@acme.example",
        contact_phone="07 1234 5678",
        status="Active",
        contacts={"items": [{"first_name": "Jane", "last_name": "Doe", "include_in_emails": True}]},
        delivery_addresses={
            "items": [
                {
                    "address_type": "STREET",
                    "address_line1": "1 Main St",
                    "city": "Sydney",
                    "region": "NSW",
                    "postal_code": "2000",
                }
            ]
        },
    )
    assert body["ContactID"] == "550e8400-e29b-41d4-a716-446655440000"
    assert body["Name"] == "Acme Pty Ltd"
    assert body["FirstName"] == "Jane"
    assert body["LastName"] == "Smith"
    assert body["TaxNumber"] == "12345678901"
    assert body["EmailAddress"] == "accounts@acme.example"
    assert body["ContactStatus"] == "ACTIVE"
    assert "BrandingTheme" not in body
    assert body["Phones"][0]["PhoneAreaCode"] == "07"
    assert len(body["Addresses"]) == 1
    assert len(body["ContactPersons"]) == 1


def test_app_delivery_addresses_to_xero_addresses_dedupes_by_type():
    rows = app_delivery_addresses_to_xero_addresses(
        {
            "items": [
                {"address_type": "STREET", "address_line1": "1 Main St", "city": "Sydney"},
                {"address_type": "STREET", "address_line1": "2 Other St", "city": "Sydney"},
                {"address_type": "POBOX", "address_line1": "PO Box 1", "city": "Sydney"},
            ]
        }
    )
    assert len(rows) == 2
    assert rows[0]["AddressType"] == "STREET"
    assert rows[0]["AddressLine1"] == "1 Main St"
    assert rows[1]["AddressType"] == "POBOX"


def test_app_delivery_addresses_to_xero_addresses_can_clear_missing_types():
    rows = app_delivery_addresses_to_xero_addresses(
        {"items": [{"address_type": "STREET", "address_line1": "1 Main St", "city": "Sydney"}]},
        replace_all_xero_address_types=True,
    )
    assert rows == [
        {"AddressType": "STREET", "AddressLine1": "1 Main St", "City": "Sydney"},
        {"AddressType": "POBOX"},
        {"AddressType": "DELIVERY"},
    ]


def test_merge_delivery_addresses_combines_street_and_pobox_by_type():
    xero_fields = customer_fields_from_xero_contact(
        {
            "Name": "Acme Pty Ltd",
            "ContactStatus": "ACTIVE",
            "Addresses": [
                {
                    "AddressType": "POBOX",
                    "AddressLine1": "PO Box 99",
                    "City": "Brisbane",
                    "Region": "QLD",
                    "PostalCode": "4000",
                },
                {
                    "AddressType": "STREET",
                    "AddressLine1": "Old Xero Street",
                    "City": "Brisbane",
                    "Region": "QLD",
                    "PostalCode": "4000",
                },
            ],
        }
    )
    out = merge_customer_fields_from_app_and_xero(
        app_fields={
            "name": "Acme Pty Ltd",
            "abn": None,
            "contact_first_name": None,
            "contact_last_name": None,
            "email_address": None,
            "contact_phone": None,
            "phones": {"items": []},
            "status": "Active",
            "contacts": {"items": []},
            "delivery_addresses": {
                "items": [
                    {
                        "address_type": "STREET",
                        "address_line1": "1 App Street",
                        "city": "Brisbane",
                        "region": "QLD",
                        "postal_code": "4000",
                    }
                ]
            },
            "brand_id": None,
            "brand_code": None,
        },
        xero_fields=xero_fields,
    )
    items = out["merged"]["delivery_addresses"]["items"]
    assert len(items) == 2
    by_type = {item["address_type"]: item for item in items}
    assert by_type["STREET"]["address_line1"] == "1 App Street"
    assert by_type["POBOX"]["address_line1"] == "PO Box 99"
    assert out["field_sources"]["delivery_addresses"] == "mixed"


def test_customer_to_xero_contact_create_body():
    body = customer_to_xero_contact_create_body(
        name="Acme Pty Ltd",
        abn="12345678901",
        contact_first_name="Jane",
        contact_last_name="Smith",
        email_address="accounts@acme.example",
        contact_phone="07 1234 5678",
        status="Active",
        contacts={"items": [{"first_name": "Jane", "last_name": "Doe", "include_in_emails": True}]},
        delivery_addresses={
            "items": [
                {
                    "address_type": "STREET",
                    "address_line1": "1 Main St",
                    "city": "Sydney",
                    "region": "NSW",
                    "postal_code": "2000",
                }
            ]
        },
    )
    assert "ContactID" not in body
    assert body["Name"] == "Acme Pty Ltd"
    assert body["FirstName"] == "Jane"
    assert body["LastName"] == "Smith"
    assert body["TaxNumber"] == "12345678901"
    assert body["EmailAddress"] == "accounts@acme.example"
    assert body["ContactStatus"] == "ACTIVE"
    assert body["Phones"][0]["PhoneAreaCode"] == "07"
    assert len(body["Addresses"]) == 1
    assert len(body["ContactPersons"]) == 1


def test_pick_xero_branding_theme_id_prefers_best_name_match():
    themes = [
        {"Name": "Standard", "BrandingThemeID": "00000000-0000-4000-8000-000000000001"},
        {"Name": "Crown Pack", "BrandingThemeID": "00000000-0000-4000-8000-000000000002"},
        {"Name": "Dolphin Plastics", "BrandingThemeID": "00000000-0000-4000-8000-000000000003"},
    ]
    assert (
        pick_xero_branding_theme_id_from_list(themes, brand_code=DOLPHIN_BRAND_CODE, brand_name="Dolphin")
        == "00000000-0000-4000-8000-000000000003"
    )
    assert (
        pick_xero_branding_theme_id_from_list(themes, brand_code=CROWN_PACK_BRAND_CODE, brand_name="Crown Pack")
        == "00000000-0000-4000-8000-000000000002"
    )


def test_branding_theme_match_needles():
    assert branding_theme_match_needles(DOLPHIN_BRAND_CODE, "Dolphin") == ["dolphin plastics", "dolphin"]


def test_brand_code_from_xero_branding_theme():
    assert (
        brand_code_from_xero_branding_theme({"BrandingTheme": {"Name": "Dolphin Plastics"}})
        == DOLPHIN_BRAND_CODE
    )
    assert (
        brand_code_from_xero_branding_theme({"BrandingTheme": {"Name": "Crown Pack"}})
        == CROWN_PACK_BRAND_CODE
    )


def test_merge_customer_fields_prefers_app_scalars_and_list_by_length():
    xero_fields = customer_fields_from_xero_contact(
        {
            "Name": "Xero Name",
            "TaxNumber": "99887766554",
            "EmailAddress": "xero@example.com",
            "ContactStatus": "ACTIVE",
            "Phones": [
                {"PhoneType": "DEFAULT", "PhoneNumber": "0711111111"},
                {"PhoneType": "MOBILE", "PhoneNumber": "0400000000"},
            ],
            "Addresses": [
                {
                    "AddressType": "STREET",
                    "AddressLine1": "9 Xero Road",
                    "City": "Townsville",
                    "Region": "QLD",
                    "PostalCode": "4810",
                }
            ],
            "ContactPersons": [
                {
                    "FirstName": "Bob",
                    "LastName": "Jones",
                    "EmailAddress": "bob@example.com",
                    "IncludeInEmails": True,
                }
            ],
        }
    )
    out = merge_customer_fields_from_app_and_xero(
        app_fields={
            "name": "App Name",
            "abn": None,
            "contact_first_name": "Jane",
            "contact_last_name": None,
            "email_address": "app@example.com",
            "contact_phone": "07 2222 3333",
            "phones": {
                "items": [
                    {"phone_type": "DEFAULT", "phone_number": "22223333", "phone_area_code": "07"},
                    {"phone_type": "MOBILE", "phone_number": "0411222333"},
                ]
            },
            "status": "Active",
            "contacts": {"items": []},
            "delivery_addresses": {
                "items": [
                    {
                        "address_type": "STREET",
                        "address_line1": "1 App Street",
                        "city": "Brisbane",
                        "region": "QLD",
                        "postal_code": "4000",
                    }
                ]
            },
            "brand_id": "brand-crown",
            "brand_code": CROWN_PACK_BRAND_CODE,
        },
        xero_fields=xero_fields,
    )
    merged = out["merged"]
    sources = out["field_sources"]

    assert merged["name"] == "App Name"
    assert merged["abn"] == "99887766554"
    assert merged["email_address"] == "app@example.com"
    assert merged["contact_first_name"] == "Jane"
    assert merged["contact_last_name"] is None
    assert len(merged["phones"]["items"]) == 2
    assert merged["phones"]["items"][0]["phone_type"] == "DEFAULT"
    assert len(merged["delivery_addresses"]["items"]) == 1
    assert merged["delivery_addresses"]["items"][0]["address_line1"] == "1 App Street"
    assert len(merged["contacts"]["items"]) == 1
    assert merged["contacts"]["items"][0]["first_name"] == "Bob"
    assert merged["brand_code"] == CROWN_PACK_BRAND_CODE

    assert sources["name"] == "app"
    assert sources["abn"] == "xero"
    assert sources["email_address"] == "app"
    assert sources["phones"] == "app"
    assert sources["delivery_addresses"] == "app"
    assert sources["contacts"] == "xero"
    assert sources["brand_code"] == "app"


def test_merge_customer_fields_uses_xero_lists_when_app_empty():
    xero_fields = customer_fields_from_xero_contact(
        {
            "Name": "Acme Pty Ltd",
            "ContactStatus": "ACTIVE",
            "Phones": [{"PhoneType": "DEFAULT", "PhoneNumber": "0712345678"}],
            "Addresses": [
                {
                    "AddressType": "STREET",
                    "AddressLine1": "9 Test Road",
                    "City": "Townsville",
                    "Region": "QLD",
                    "PostalCode": "4810",
                }
            ],
            "ContactPersons": [
                {"FirstName": "Sam", "LastName": "Taylor", "IncludeInEmails": True}
            ],
        }
    )
    out = merge_customer_fields_from_app_and_xero(
        app_fields={
            "name": "Acme Pty Ltd",
            "abn": "12345678901",
            "contact_first_name": None,
            "contact_last_name": None,
            "email_address": None,
            "contact_phone": None,
            "phones": {"items": []},
            "status": "Active",
            "contacts": {"items": []},
            "delivery_addresses": {"items": []},
            "brand_id": None,
            "brand_code": None,
        },
        xero_fields=xero_fields,
    )
    merged = out["merged"]

    assert merged["abn"] == "12345678901"
    assert len(merged["phones"]["items"]) == 1
    assert len(merged["delivery_addresses"]["items"]) == 1
    assert len(merged["contacts"]["items"]) == 1
    assert out["field_sources"]["phones"] == "xero"
    assert out["field_sources"]["delivery_addresses"] == "xero"
    assert out["field_sources"]["contacts"] == "xero"


def test_merge_customer_fields_uses_xero_list_when_longer():
    xero_fields = customer_fields_from_xero_contact(
        {
            "Name": "Acme Pty Ltd",
            "ContactStatus": "ACTIVE",
            "Phones": [
                {"PhoneType": "DEFAULT", "PhoneNumber": "0711111111"},
                {"PhoneType": "MOBILE", "PhoneNumber": "0400000000"},
                {"PhoneType": "FAX", "PhoneNumber": "0712222222"},
            ],
            "ContactPersons": [
                {"FirstName": "Bob", "LastName": "Jones", "IncludeInEmails": True},
                {"FirstName": "Ann", "LastName": "Lee", "IncludeInEmails": True},
            ],
        }
    )
    out = merge_customer_fields_from_app_and_xero(
        app_fields={
            "name": "Acme Pty Ltd",
            "abn": None,
            "contact_first_name": None,
            "contact_last_name": None,
            "email_address": None,
            "contact_phone": "07 3333 4444",
            "phones": {
                "items": [
                    {"phone_type": "DEFAULT", "phone_number": "33334444", "phone_area_code": "07"},
                ]
            },
            "status": "Active",
            "contacts": {"items": [{"first_name": "Sam", "last_name": "Taylor", "include_in_emails": True}]},
            "delivery_addresses": {"items": []},
            "brand_id": None,
            "brand_code": None,
        },
        xero_fields=xero_fields,
    )

    assert len(out["merged"]["phones"]["items"]) == 3
    assert out["merged"]["phones"]["items"][2]["phone_type"] == "FAX"
    assert len(out["merged"]["contacts"]["items"]) == 2
    assert out["field_sources"]["phones"] == "xero"
    assert out["field_sources"]["contacts"] == "xero"
