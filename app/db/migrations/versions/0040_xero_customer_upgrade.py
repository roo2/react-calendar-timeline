"""Xero customer sync fields, contact/address JSON, brand themes, primary contact.

Consolidates:
- customers.email_address, xero_last_modified, xero_synced_at
- Xero-compatible contacts / delivery_addresses JSON normalization
- brands.xero_branding_theme_id (+ production theme seed)
- customers.contact_first_name / contact_last_name (split from contacts JSON)

Revision ID: 0040_xero_customer_upgrade
Revises: 0039_approved_packaging_brand
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

from app.customers.contact_address import (
    normalize_contact_item,
    normalize_contacts,
    normalize_delivery_addresses,
    split_primary_contact_from_contacts,
)

revision = "0040_xero_customer_upgrade"
down_revision = "0039_approved_packaging_brand"
branch_labels = None
depends_on = None

# Crown Pack / Dolphin Plastics / Approved Packaging in production Xero org.
_BRAND_XERO_THEME_BY_CODE: dict[str, str] = {
    "CROWN_PACK": "ea785bba-67b0-4ab8-8d26-93d1d50d9181",
    "DOLPHIN": "219149e4-48f8-48f0-a8db-28a7c92b4310",
    "APPROVED_PACKAGING": "9747d463-3908-410e-8d9d-3b05eab59468",
}


def _cols(table_name: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table_name)}


def _parse_json_column(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except json.JSONDecodeError:
            return None
    return None


def _json_equal(a: Any, b: Any) -> bool:
    return json.dumps(a, sort_keys=True, default=str) == json.dumps(b, sort_keys=True, default=str)


def _legacy_primary_email(contacts_raw: Any) -> str | None:
    items: list[Any]
    if isinstance(contacts_raw, dict):
        items = contacts_raw.get("items") if isinstance(contacts_raw.get("items"), list) else []
    elif isinstance(contacts_raw, list):
        items = contacts_raw
    else:
        return None

    primary: str | None = None
    fallback: str | None = None
    for row in items:
        if not isinstance(row, dict):
            continue
        email = str(row.get("email_address") or row.get("email") or "").strip()
        if not email:
            continue
        contact_type = str(row.get("type") or "").strip().casefold()
        if contact_type == "primary contact":
            primary = email
            break
        if fallback is None:
            fallback = email
    return primary or fallback


def _migrate_customer_row(
    *,
    contacts_raw: Any,
    addresses_raw: Any,
    email_address: str | None,
    contact_first_name: str | None,
    contact_last_name: str | None,
) -> tuple[dict[str, Any], dict[str, Any], str | None, str | None, str | None]:
    """Normalize JSON, backfill email, and split primary contact in one pass."""
    normalized_contacts = normalize_contacts(contacts_raw)
    new_addresses = normalize_delivery_addresses(addresses_raw)

    new_email = (email_address or "").strip() or None
    if not new_email:
        new_email = _legacy_primary_email(contacts_raw)

    existing_first = (contact_first_name or "").strip()
    existing_last = (contact_last_name or "").strip()
    if existing_first or existing_last:
        return normalized_contacts, new_addresses, new_email, existing_first or None, existing_last or None

    first, last, email_fallback, additional_contacts = split_primary_contact_from_contacts(
        normalized_contacts,
        email_address=new_email,
    )
    final_email = new_email or email_fallback
    return additional_contacts, new_addresses, final_email, first or None, last or None


def upgrade() -> None:
    customer_cols = _cols("customers")
    if "email_address" not in customer_cols:
        op.add_column("customers", sa.Column("email_address", sa.String(length=255), nullable=True))
    if "xero_last_modified" not in customer_cols:
        op.add_column(
            "customers",
            sa.Column("xero_last_modified", sa.DateTime(timezone=True), nullable=True),
        )
    if "xero_synced_at" not in customer_cols:
        op.add_column(
            "customers",
            sa.Column("xero_synced_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "contact_first_name" not in customer_cols:
        op.add_column("customers", sa.Column("contact_first_name", sa.String(length=255), nullable=True))
    if "contact_last_name" not in customer_cols:
        op.add_column("customers", sa.Column("contact_last_name", sa.String(length=255), nullable=True))

    brand_cols = _cols("brands")
    if "xero_branding_theme_id" not in brand_cols:
        op.add_column("brands", sa.Column("xero_branding_theme_id", sa.String(length=36), nullable=True))
        op.create_index("ix_brands_xero_branding_theme_id", "brands", ["xero_branding_theme_id"], unique=False)

    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    for code, theme_id in _BRAND_XERO_THEME_BY_CODE.items():
        conn.execute(
            sa.text(
                "UPDATE brands SET xero_branding_theme_id = :theme_id "
                "WHERE code = :code AND (xero_branding_theme_id IS NULL OR xero_branding_theme_id = '')"
            ),
            {"code": code, "theme_id": theme_id},
        )

    rows = conn.execute(
        sa.text(
            "SELECT id, contacts, delivery_addresses, email_address, "
            "contact_first_name, contact_last_name FROM customers"
        )
    ).fetchall()

    for row in rows:
        cid = row[0]
        contacts_raw = _parse_json_column(row[1])
        addresses_raw = _parse_json_column(row[2])
        email_raw = row[3]
        first_raw = row[4]
        last_raw = row[5]

        new_contacts, new_addresses, new_email, new_first, new_last = _migrate_customer_row(
            contacts_raw=contacts_raw,
            addresses_raw=addresses_raw,
            email_address=str(email_raw).strip() if email_raw else None,
            contact_first_name=str(first_raw).strip() if first_raw else None,
            contact_last_name=str(last_raw).strip() if last_raw else None,
        )

        old_contacts = contacts_raw if isinstance(contacts_raw, dict) else {"items": []}
        old_addresses = addresses_raw if isinstance(addresses_raw, dict) else {"items": []}
        old_email = (str(email_raw).strip() if email_raw else "") or None
        old_first = (str(first_raw).strip() if first_raw else "") or None
        old_last = (str(last_raw).strip() if last_raw else "") or None

        if (
            _json_equal(old_contacts, new_contacts)
            and _json_equal(old_addresses, new_addresses)
            and old_email == new_email
            and old_first == (new_first or "")
            and old_last == (new_last or "")
        ):
            continue

        contacts_json = json.dumps(new_contacts)
        addresses_json = json.dumps(new_addresses)
        if is_sqlite:
            conn.execute(
                sa.text(
                    "UPDATE customers SET contacts = :contacts, delivery_addresses = :addresses, "
                    "email_address = :email, contact_first_name = :first_name, "
                    "contact_last_name = :last_name WHERE id = :id"
                ),
                {
                    "id": cid,
                    "contacts": contacts_json,
                    "addresses": addresses_json,
                    "email": new_email,
                    "first_name": new_first,
                    "last_name": new_last,
                },
            )
        else:
            conn.execute(
                sa.text(
                    "UPDATE customers SET contacts = CAST(:contacts AS jsonb), "
                    "delivery_addresses = CAST(:addresses AS jsonb), "
                    "email_address = :email, contact_first_name = :first_name, "
                    "contact_last_name = :last_name WHERE id = :id"
                ),
                {
                    "id": cid,
                    "contacts": contacts_json,
                    "addresses": addresses_json,
                    "email": new_email,
                    "first_name": new_first,
                    "last_name": new_last,
                },
            )


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    customer_cols = _cols("customers")

    if "contact_first_name" in customer_cols or "contact_last_name" in customer_cols:
        rows = conn.execute(
            sa.text("SELECT id, contacts, email_address, contact_first_name, contact_last_name FROM customers")
        ).fetchall()

        for row in rows:
            cid = row[0]
            contacts_raw = _parse_json_column(row[1])
            email_raw = row[2]
            first = (str(row[3]).strip() if row[3] else "") or ""
            last = (str(row[4]).strip() if row[4] else "") or ""

            items: list[Any] = []
            if isinstance(contacts_raw, dict) and isinstance(contacts_raw.get("items"), list):
                items = list(contacts_raw["items"])
            elif isinstance(contacts_raw, list):
                items = list(contacts_raw)

            if first or last:
                primary = normalize_contact_item(
                    {"first_name": first, "last_name": last, "include_in_emails": True}
                )
                email = (str(email_raw).strip() if email_raw else "") or None
                if email:
                    primary["email_address"] = email
                items.insert(0, primary)

            contacts_json = json.dumps({"items": items})
            if is_sqlite:
                conn.execute(
                    sa.text(
                        "UPDATE customers SET contacts = :contacts, contact_first_name = NULL, "
                        "contact_last_name = NULL WHERE id = :id"
                    ),
                    {"id": cid, "contacts": contacts_json},
                )
            else:
                conn.execute(
                    sa.text(
                        "UPDATE customers SET contacts = CAST(:contacts AS jsonb), contact_first_name = NULL, "
                        "contact_last_name = NULL WHERE id = :id"
                    ),
                    {"id": cid, "contacts": contacts_json},
                )

    brand_cols = _cols("brands")
    if "xero_branding_theme_id" in brand_cols:
        with op.batch_alter_table("brands") as batch:
            batch.drop_index("ix_brands_xero_branding_theme_id")
            batch.drop_column("xero_branding_theme_id")

    customer_cols = _cols("customers")
    with op.batch_alter_table("customers") as batch:
        if "contact_last_name" in customer_cols:
            batch.drop_column("contact_last_name")
        if "contact_first_name" in customer_cols:
            batch.drop_column("contact_first_name")
        if "xero_synced_at" in customer_cols:
            batch.drop_column("xero_synced_at")
        if "xero_last_modified" in customer_cols:
            batch.drop_column("xero_last_modified")
        if "email_address" in customer_cols:
            batch.drop_column("email_address")
