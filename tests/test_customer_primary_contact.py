"""Tests for primary vs additional customer contact JSON split."""

from __future__ import annotations

from app.customers.contact_address import split_primary_contact_from_contacts


def test_split_primary_contact_moves_first_row():
    first, last, email, contacts = split_primary_contact_from_contacts(
        {
            "items": [
                {"first_name": "Jane", "last_name": "Doe", "email_address": "jane@example.com"},
                {"first_name": "Bob", "last_name": "Jones"},
            ]
        },
        email_address=None,
    )
    assert first == "Jane"
    assert last == "Doe"
    assert email == "jane@example.com"
    assert contacts == {"items": [{"first_name": "Bob", "last_name": "Jones", "include_in_emails": True}]}


def test_split_primary_contact_prefers_legacy_primary_type():
    first, last, email, contacts = split_primary_contact_from_contacts(
        {
            "items": [
                {"first_name": "Other", "last_name": "Person"},
                {"type": "Primary Contact", "first_name": "Primary", "last_name": "Contact"},
            ]
        },
        email_address="accounts@example.com",
    )
    assert first == "Primary"
    assert last == "Contact"
    assert email == "accounts@example.com"
    assert contacts["items"][0]["first_name"] == "Other"


def test_split_primary_contact_keeps_existing_email():
    first, last, email, contacts = split_primary_contact_from_contacts(
        {"items": [{"first_name": "Jane", "last_name": "Doe", "email_address": "jane@example.com"}]},
        email_address="accounts@example.com",
    )
    assert first == "Jane"
    assert last == "Doe"
    assert email == "accounts@example.com"
    assert contacts == {"items": []}
