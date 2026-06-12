"""Tests for brand Xero theme mapping."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

from app.brands.service import brand_id_for_xero_branding_theme_id
from app.integrations.xero.service import _xero_branding_theme_id_for_brand


def test_brand_id_for_xero_branding_theme_id():
    db = MagicMock()
    theme_id = "219149e4-48f8-48f0-a8db-28a7c92b4310"
    brand_id = str(uuid.uuid4())
    db.scalar.return_value = brand_id
    assert brand_id_for_xero_branding_theme_id(db, theme_id) == brand_id


def test_xero_branding_theme_id_for_brand_uses_stored_id():
    db = MagicMock()
    brand = MagicMock()
    brand.code = "DOLPHIN"
    brand.name = "Dolphin"
    brand.xero_branding_theme_id = "219149e4-48f8-48f0-a8db-28a7c92b4310"
    assert _xero_branding_theme_id_for_brand(db, brand) == "219149e4-48f8-48f0-a8db-28a7c92b4310"
    db.scalar.assert_not_called()
