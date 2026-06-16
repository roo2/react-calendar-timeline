"""Unit tests for sync_customer_from_xero service."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from app.integrations.xero.service import (
    XeroConfigError,
    list_linked_customers_for_merge,
    merge_customer_with_xero,
    sync_customer_from_xero,
    sync_customer_to_xero,
)


def test_sync_customer_from_xero_requires_link():
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.xero_contact_id = None
    db.get.return_value = cust
    with pytest.raises(XeroConfigError, match="not linked"):
        sync_customer_from_xero(db, customer_id="cust-1")


@patch("app.integrations.xero.service.brand_id_for_code", return_value="brand-dolphin")
@patch("app.integrations.xero.service.ensure_default_customer_brands")
@patch("app.integrations.xero.service._xero_api_get_json")
def test_sync_customer_from_xero_updates_customer(mock_get, _mock_ensure, mock_brand_id):
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.xero_contact_id = "550e8400-e29b-41d4-a716-446655440000"
    cust.name = "Old Name"
    cust.status = "Active"
    cust.notes = "Existing app note"
    db.get.return_value = cust

    mock_get.return_value = (
        200,
        {},
        {
            "Contacts": [
                {
                    "ContactID": "550e8400-e29b-41d4-a716-446655440000",
                    "Name": "New Name",
                    "FirstName": "Sam",
                    "LastName": "Taylor",
                    "TaxNumber": "99887766554",
                    "ContactStatus": "ACTIVE",
                    "EmailAddress": "info@new.example",
                    "BrandingTheme": {"Name": "Dolphin Plastics"},
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
                }
            ]
        },
    )

    out = sync_customer_from_xero(db, customer_id="cust-1")
    assert out["ok"] is True
    assert out["customer_name"] == "New Name"
    assert out["contacts_count"] == 0
    assert out["addresses_count"] == 1
    assert cust.name == "New Name"
    assert cust.contact_first_name == "Sam"
    assert cust.contact_last_name == "Taylor"
    assert cust.abn == "99887766554"
    assert cust.email_address == "info@new.example"
    assert cust.contact_phone == "0712345678"
    assert cust.notes == "Existing app note"
    assert cust.xero_synced_at is not None
    assert cust.brand_id == "brand-dolphin"
    assert "notes" not in out["updated_fields"]
    assert "brand_id" in out["updated_fields"]
    mock_get.assert_called_once()
    mock_brand_id.assert_called_once()
    db.add.assert_called_once_with(cust)
    db.commit.assert_called_once()


def test_sync_customer_to_xero_requires_link():
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.xero_contact_id = None
    db.scalar.return_value = cust
    with pytest.raises(XeroConfigError, match="not linked"):
        sync_customer_to_xero(db, customer_id="cust-1")


@patch("app.integrations.xero.service._xero_api_post_json")
def test_sync_customer_to_xero_posts_contact_only(mock_post):
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.xero_contact_id = "550e8400-e29b-41d4-a716-446655440000"
    cust.name = "Acme Pty Ltd"
    cust.abn = "12345678901"
    cust.contact_first_name = "Jane"
    cust.contact_last_name = "Doe"
    cust.email_address = "accounts@acme.example"
    cust.contact_phone = "07 1234 5678"
    cust.status = "Active"
    cust.contacts = {"items": []}
    cust.delivery_addresses = {
        "items": [
            {
                "address_type": "STREET",
                "address_line1": "1 Main St",
                "city": "Sydney",
                "region": "NSW",
                "postal_code": "2000",
            }
        ]
    }
    cust.notes = "Updated customer note"
    db.scalar.return_value = cust

    mock_post.return_value = (
        "https://api.xero.com/api.xro/2.0/Contacts",
        200,
        {
            "Contacts": [
                {
                    "ContactID": "550e8400-e29b-41d4-a716-446655440000",
                    "Name": "Acme Pty Ltd",
                    "UpdatedDateUTC": "/Date(1779930270423+0000)/",
                }
            ]
        },
    )

    out = sync_customer_to_xero(db, customer_id="cust-1")
    assert out["ok"] is True
    assert out["direction"] == "to_xero"
    assert out["customer_name"] == "Acme Pty Ltd"
    assert out["contacts_count"] == 0
    assert out["addresses_count"] == 1
    assert "notes" not in out["sent_fields"]
    assert "branding_theme" not in out["sent_fields"]
    mock_post.assert_called_once()
    posted = mock_post.call_args.kwargs["body"]["Contacts"][0]
    assert posted["ContactID"] == "550e8400-e29b-41d4-a716-446655440000"
    assert posted["Name"] == "Acme Pty Ltd"
    assert posted["FirstName"] == "Jane"
    assert posted["LastName"] == "Doe"
    assert "BrandingTheme" not in posted
    assert cust.xero_synced_at is not None
    db.add.assert_called_once_with(cust)
    db.commit.assert_called_once()


@patch("app.integrations.xero.service._xero_api_post_json")
@patch("app.integrations.xero.service._xero_api_get_json")
def test_merge_customer_with_xero_updates_both_sides(mock_get, mock_post):
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.xero_contact_id = "550e8400-e29b-41d4-a716-446655440000"
    cust.name = "App Name"
    cust.abn = "12345678901"
    cust.contact_first_name = None
    cust.contact_last_name = None
    cust.email_address = "app@example.com"
    cust.contact_phone = None
    cust.phones = {"items": []}
    cust.status = "Active"
    cust.contacts = {"items": []}
    cust.delivery_addresses = {"items": []}
    cust.brand_id = None
    cust.brand = None
    db.scalar.return_value = cust

    mock_get.return_value = (
        200,
        {},
        {
            "Contacts": [
                {
                    "ContactID": "550e8400-e29b-41d4-a716-446655440000",
                    "Name": "Xero Name",
                    "TaxNumber": "99887766554",
                    "ContactStatus": "ACTIVE",
                    "EmailAddress": "xero@example.com",
                    "Phones": [{"PhoneType": "DEFAULT", "PhoneNumber": "0712345678"}],
                    "UpdatedDateUTC": "/Date(1779930270423+0000)/",
                }
            ]
        },
    )
    mock_post.return_value = (
        "https://api.xero.com/api.xro/2.0/Contacts",
        200,
        {
            "Contacts": [
                {
                    "ContactID": "550e8400-e29b-41d4-a716-446655440000",
                    "Name": "App Name",
                    "UpdatedDateUTC": "/Date(1779930270423+0000)/",
                }
            ]
        },
    )

    out = merge_customer_with_xero(db, customer_id="cust-1")
    assert out["ok"] is True
    assert out["direction"] == "merge"
    assert out["customer_name"] == "App Name"
    assert out["field_sources"]["name"] == "app"
    assert out["field_sources"]["abn"] == "app"
    assert out["field_sources"]["email_address"] == "app"
    assert out["field_sources"]["phones"] == "xero"
    assert cust.name == "App Name"
    assert cust.abn == "12345678901"
    assert cust.email_address == "app@example.com"
    assert cust.contact_phone == "0712345678"
    mock_get.assert_called_once()
    mock_post.assert_called_once()
    posted = mock_post.call_args.kwargs["body"]["Contacts"][0]
    assert posted["Name"] == "App Name"
    assert posted["TaxNumber"] == "12345678901"
    assert posted["EmailAddress"] == "app@example.com"
    assert posted["Phones"][0]["PhoneNumber"] == "0712345678"
    db.commit.assert_called_once()


def test_list_linked_customers_for_merge_excludes_unlinked_and_draft():
    db = MagicMock()
    linked = MagicMock()
    linked.id = "cust-linked"
    linked.name = "Linked Co"
    linked.xero_contact_id = "550e8400-e29b-41d4-a716-446655440000"
    linked.xero_synced_at = None
    db.scalars.return_value.all.return_value = [linked]

    out = list_linked_customers_for_merge(db)
    assert out["total_linked"] == 1
    assert out["merge_count"] == 1
    assert out["skipped_recent_count"] == 0
    assert out["items"] == [
        {
            "customer_id": "cust-linked",
            "customer_name": "Linked Co",
            "contact_id": "550e8400-e29b-41d4-a716-446655440000",
            "xero_synced_at": None,
        }
    ]


def test_list_linked_customers_for_merge_skips_recently_synced():
    from datetime import UTC, datetime, timedelta

    db = MagicMock()
    recent = MagicMock()
    recent.id = "cust-recent"
    recent.name = "Recent Co"
    recent.xero_contact_id = "550e8400-e29b-41d4-a716-446655440001"
    recent.xero_synced_at = datetime.now(UTC) - timedelta(minutes=10)
    stale = MagicMock()
    stale.id = "cust-stale"
    stale.name = "Stale Co"
    stale.xero_contact_id = "550e8400-e29b-41d4-a716-446655440002"
    stale.xero_synced_at = datetime.now(UTC) - timedelta(hours=2)
    db.scalars.return_value.all.return_value = [recent, stale]

    out = list_linked_customers_for_merge(db, skip_synced_within=timedelta(hours=1))
    assert out["merge_count"] == 1
    assert out["skipped_recent_count"] == 1
    assert out["items"][0]["customer_id"] == "cust-stale"
    assert out["skipped_recent"][0]["customer_id"] == "cust-recent"


def test_xero_http_response_retries_on_rate_limit():
    from app.integrations.xero.service import _xero_http_response

    responses = [
        httpx.Response(429, headers={"Retry-After": "0"}, request=httpx.Request("GET", "https://example.com")),
        httpx.Response(200, json={"ok": True}, request=httpx.Request("GET", "https://example.com")),
    ]

    class FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def get(self, url, headers):
            return responses.pop(0)

    with patch("app.integrations.xero.service.httpx.Client", FakeClient):
        with patch("app.integrations.xero.service.time.sleep") as mock_sleep:
            resp = _xero_http_response(
                method="GET",
                url="https://example.com/contacts",
                headers={"Authorization": "Bearer test"},
            )
    assert resp.status_code == 200
    mock_sleep.assert_called_once()
