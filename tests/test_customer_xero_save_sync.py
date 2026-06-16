"""Tests for best-effort Xero sync on customer save."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from app.db.myob_import_placeholders import MYOB_DRAFT_INTERNAL_CUSTOMER_ID
from app.integrations.xero.customer_save_sync import sync_customer_to_xero_after_save


@patch("app.integrations.xero.customer_save_sync.SessionLocal")
@patch("app.integrations.xero.customer_save_sync._xero_ready", return_value=False)
def test_sync_after_save_skips_when_xero_not_ready(_mock_ready, mock_session_local):
    del mock_session_local
    out = sync_customer_to_xero_after_save(customer_id="cust-1")
    assert out == {"status": "skipped", "reason": "xero_not_connected"}


def test_sync_after_save_skips_system_customer():
    out = sync_customer_to_xero_after_save(customer_id=str(MYOB_DRAFT_INTERNAL_CUSTOMER_ID))
    assert out == {"status": "skipped", "reason": "system_customer"}


@patch("app.integrations.xero.customer_save_sync.create_xero_contact_for_customer")
@patch("app.integrations.xero.customer_save_sync.sync_customer_to_xero")
@patch("app.integrations.xero.customer_save_sync._xero_ready", return_value=True)
@patch("app.integrations.xero.customer_save_sync.SessionLocal")
def test_sync_after_save_creates_contact_when_unlinked(
    mock_session_local,
    _mock_ready,
    mock_sync,
    mock_create,
):
    db = MagicMock()
    mock_session_local.return_value.__enter__.return_value = db
    db.scalar.return_value = None
    mock_create.return_value = {
        "contact_id": "550e8400-e29b-41d4-a716-446655440000",
        "customer_name": "Acme Pty Ltd",
    }

    out = sync_customer_to_xero_after_save(customer_id="cust-1")
    assert out["status"] == "created"
    assert out["contact_id"] == "550e8400-e29b-41d4-a716-446655440000"
    mock_create.assert_called_once_with(db, customer_id="cust-1")
    mock_sync.assert_not_called()


@patch("app.integrations.xero.customer_save_sync.create_xero_contact_for_customer")
@patch("app.integrations.xero.customer_save_sync.sync_customer_to_xero")
@patch("app.integrations.xero.customer_save_sync._xero_ready", return_value=True)
@patch("app.integrations.xero.customer_save_sync.SessionLocal")
def test_sync_after_save_pushes_when_linked(
    mock_session_local,
    _mock_ready,
    mock_sync,
    mock_create,
):
    db = MagicMock()
    mock_session_local.return_value.__enter__.return_value = db
    db.scalar.return_value = "550e8400-e29b-41d4-a716-446655440000"
    mock_sync.return_value = {
        "contact_id": "550e8400-e29b-41d4-a716-446655440000",
        "customer_name": "Acme Pty Ltd",
    }

    out = sync_customer_to_xero_after_save(customer_id="cust-1")
    assert out["status"] == "synced"
    mock_sync.assert_called_once_with(db, customer_id="cust-1")
    mock_create.assert_not_called()


@patch("app.integrations.xero.customer_save_sync.create_xero_contact_for_customer")
@patch("app.integrations.xero.customer_save_sync._xero_ready", return_value=True)
@patch("app.integrations.xero.customer_save_sync.SessionLocal")
def test_sync_after_save_returns_failure_without_raising(
    mock_session_local,
    _mock_ready,
    mock_create,
):
    from app.integrations.xero.service import XeroApiError

    db = MagicMock()
    mock_session_local.return_value.__enter__.return_value = db
    db.scalar.return_value = None
    mock_create.side_effect = XeroApiError("Xero unavailable")

    out = sync_customer_to_xero_after_save(customer_id="cust-1")
    assert out["status"] == "failed"
    assert "Xero unavailable" in out["error"]
