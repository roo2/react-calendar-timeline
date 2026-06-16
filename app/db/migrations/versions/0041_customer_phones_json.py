"""Add customers.phones JSON and migrate legacy contact_phone.

Revision ID: 0041_customer_phones_json
Revises: 0040_xero_customer_upgrade
"""

from __future__ import annotations

import json
from typing import Any

import sqlalchemy as sa
from alembic import op

from app.customers.contact_address import normalize_phones, primary_phone_display

revision = "0041_customer_phones_json"
down_revision = "0040_xero_customer_upgrade"
branch_labels = None
depends_on = None


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


def upgrade() -> None:
    customer_cols = _cols("customers")
    if "phones" not in customer_cols:
        op.add_column("customers", sa.Column("phones", sa.JSON(), nullable=True))

    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"
    rows = conn.execute(sa.text("SELECT id, contact_phone, phones FROM customers")).fetchall()

    for row in rows:
        cid = row[0]
        contact_phone = str(row[1]).strip() if row[1] else None
        phones_raw = _parse_json_column(row[2]) if len(row) > 2 else None
        new_phones = normalize_phones(phones_raw, contact_phone=contact_phone)
        new_primary = primary_phone_display(new_phones, contact_phone=contact_phone)
        phones_json = json.dumps(new_phones)
        if is_sqlite:
            conn.execute(
                sa.text(
                    "UPDATE customers SET phones = :phones, contact_phone = :contact_phone WHERE id = :id"
                ),
                {"id": cid, "phones": phones_json, "contact_phone": new_primary},
            )
        else:
            conn.execute(
                sa.text(
                    "UPDATE customers SET phones = CAST(:phones AS jsonb), contact_phone = :contact_phone "
                    "WHERE id = :id"
                ),
                {"id": cid, "phones": phones_json, "contact_phone": new_primary},
            )


def downgrade() -> None:
    customer_cols = _cols("customers")
    if "phones" in customer_cols:
        with op.batch_alter_table("customers") as batch:
            batch.drop_column("phones")
