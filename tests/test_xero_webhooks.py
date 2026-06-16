"""Tests for Xero webhook verification and contact event handling."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import UTC, datetime
from unittest.mock import MagicMock, patch

import pytest

from app.integrations.xero.webhooks import (
    compute_xero_webhook_intent_hash,
    process_xero_webhook_payload,
    verify_xero_webhook_signature,
)
from app.integrations.xero.service import XeroConfigError, sync_customer_from_xero


def test_compute_xero_webhook_intent_hash():
    body = b'{"text":"test"}'
    key = "secret-key"
    expected = base64.b64encode(hashlib.sha256(key.encode("utf-8") + body).digest()).decode("utf-8")
    assert compute_xero_webhook_intent_hash(body=body, webhook_key=key) == expected


def test_verify_xero_webhook_signature():
    body = b'{"events":[]}'
    key = "secret-key"
    signature = base64.b64encode(
        hmac.new(key.encode("utf-8"), body, hashlib.sha256).digest()
    ).decode("utf-8")
    assert verify_xero_webhook_signature(body=body, signature=signature, webhook_key=key)
    assert not verify_xero_webhook_signature(body=body, signature="bad", webhook_key=key)


@patch("app.integrations.xero.webhooks.settings")
def test_process_intent_payload(mock_settings):
    mock_settings.XERO_WEBHOOK_KEY = "secret-key"
    body = b'{"text":"hello"}'
    out = process_xero_webhook_payload(MagicMock(), body=body, payload={"text": "hello"})
    assert out["kind"] == "intent"
    assert out["hash"] == compute_xero_webhook_intent_hash(body=body, webhook_key="secret-key")


@patch("app.integrations.xero.webhooks.sync_customer_from_xero")
@patch("app.integrations.xero.webhooks._xero_tenant_matches", return_value=True)
@patch("app.integrations.xero.webhooks.xero_configured", return_value=True)
@patch("app.integrations.xero.webhooks.settings")
def test_process_contact_update_event(
    mock_settings,
    _mock_configured,
    _mock_tenant,
    mock_sync,
):
    mock_settings.XERO_WEBHOOK_KEY = "secret-key"
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    db.scalar.return_value = cust
    mock_sync.return_value = {
        "ok": True,
        "customer_name": "Acme Pty Ltd",
    }

    payload = {
        "events": [
            {
                "eventCategory": "CONTACT",
                "eventType": "UPDATE",
                "resourceId": "550e8400-e29b-41d4-a716-446655440000",
                "tenantId": "tenant-1",
            }
        ]
    }
    out = process_xero_webhook_payload(db, body=json.dumps(payload).encode("utf-8"), payload=payload)
    assert out["kind"] == "events"
    assert out["processed"] == 1
    assert out["results"][0]["status"] == "updated"
    mock_sync.assert_called_once_with(
        db,
        customer_id="cust-1",
        skip_if_not_newer=True,
        sync_source="webhook",
    )


@patch("app.integrations.xero.webhooks.sync_customer_from_xero")
@patch("app.integrations.xero.webhooks._xero_tenant_matches", return_value=True)
@patch("app.integrations.xero.webhooks.xero_configured", return_value=True)
@patch("app.integrations.xero.webhooks.settings")
def test_process_contact_event_skips_echo(
    mock_settings,
    _mock_configured,
    _mock_tenant,
    mock_sync,
):
    mock_settings.XERO_WEBHOOK_KEY = "secret-key"
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    db.scalar.return_value = cust
    mock_sync.return_value = {
        "ok": True,
        "skipped": True,
        "skip_reason": "not_newer_than_stored",
    }

    payload = {
        "events": [
            {
                "eventCategory": "CONTACT",
                "eventType": "UPDATE",
                "resourceId": "550e8400-e29b-41d4-a716-446655440000",
            }
        ]
    }
    out = process_xero_webhook_payload(db, body=json.dumps(payload).encode("utf-8"), payload=payload)
    assert out["results"][0]["status"] == "skipped"
    assert out["results"][0]["reason"] == "not_newer_than_stored"


@patch("app.integrations.xero.service._xero_api_get_json")
def test_sync_customer_from_xero_skips_when_not_newer(mock_get):
    db = MagicMock()
    cust = MagicMock()
    cust.id = "cust-1"
    cust.name = "Acme Pty Ltd"
    cust.xero_contact_id = "550e8400-e29b-41d4-a716-446655440000"
    cust.xero_last_modified = datetime(2026, 6, 16, 12, 0, 0, tzinfo=UTC)
    db.get.return_value = cust

    mock_get.return_value = (
        200,
        {},
        {
            "Contacts": [
                {
                    "ContactID": "550e8400-e29b-41d4-a716-446655440000",
                    "Name": "Acme Pty Ltd",
                    "ContactStatus": "ACTIVE",
                    "UpdatedDateUTC": "/Date(1781601600000+0000)/",
                }
            ]
        },
    )

    out = sync_customer_from_xero(
        db,
        customer_id="cust-1",
        skip_if_not_newer=True,
        sync_source="webhook",
    )
    assert out["skipped"] is True
    assert out["skip_reason"] == "not_newer_than_stored"
    db.commit.assert_not_called()
