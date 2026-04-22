"""Customer MYOB sync, payment terms JSON, remove customer code (consolidated).

Replaces former revisions 0012_customer_myob_sync, 0013_customer_payment_terms_json,
0014_remove_customer_code.

Revision ID: 0010_cust_myob_json_nocode
Revises: 0009_resell_products
"""

from __future__ import annotations

import json
import re
from typing import Any

import sqlalchemy as sa
from alembic import op

revision = "0010_cust_myob_json_nocode"
down_revision = "0009_resell_products"
branch_labels = None
depends_on = None


def _legacy_string_to_payment_terms_dict(s: str | None) -> dict[str, Any] | None:
    """Best-effort map old free-text payment_terms to structured dict."""
    if s is None:
        return None
    t = str(s).strip()
    if not t:
        return None
    if t in ("Cash on delivery",):
        return {"payment_is_due": "CashOnDelivery"}
    if t in ("Prepaid", "Up Front"):
        return {"payment_is_due": "PrePaid"}
    m = re.fullmatch(r"Within (\d{1,3}) days of invoice", t)
    if m:
        n = int(m.group(1))
        return {"payment_is_due": "InAGivenNumberOfDays", "balance_due_date": n}
    m = re.fullmatch(r"Due on day (\d{1,2}) of the month", t)
    if m:
        n = int(m.group(1))
        return {"payment_is_due": "OnADayOfTheMonth", "balance_due_date": n}
    m = re.fullmatch(r"(\d{1,3}) days after end of month", t)
    if m:
        n = int(m.group(1))
        return {"payment_is_due": "NumberOfDaysAfterEOM", "balance_due_date": n}
    m = re.fullmatch(r"Discount by day (\d{1,2}), balance by day (\d{1,2}) after end of month", t)
    if m:
        d, b = int(m.group(1)), int(m.group(2))
        return {
            "payment_is_due": "DayOfMonthAfterEOM",
            "discount_date": d,
            "balance_due_date": b,
        }
    if t in ("7 days", "14 days", "21 days", "31 days"):
        n = int(t.split()[0])
        return {"payment_is_due": "InAGivenNumberOfDays", "balance_due_date": n}
    if t == "EoM + 30 days":
        return {"payment_is_due": "NumberOfDaysAfterEOM", "balance_due_date": 30}
    if t == "EoM + 45 days":
        return {"payment_is_due": "NumberOfDaysAfterEOM", "balance_due_date": 45}
    if t == "EoM + 60 days":
        return {"payment_is_due": "NumberOfDaysAfterEOM", "balance_due_date": 60}
    return None


def _upgrade_payment_terms_to_json() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    if is_sqlite:
        op.execute(sa.text('ALTER TABLE customers RENAME COLUMN "payment_terms" TO "payment_terms_old"'))
        op.add_column("customers", sa.Column("payment_terms", sa.JSON(), nullable=True))
    else:
        op.add_column("customers", sa.Column("payment_terms_new", sa.JSON(), nullable=True))

    if is_sqlite:
        rows = conn.execute(sa.text("SELECT id, payment_terms_old FROM customers")).fetchall()
        for row in rows:
            cid, old = row[0], row[1]
            d = _legacy_string_to_payment_terms_dict(old)
            if d is None:
                conn.execute(
                    sa.text("UPDATE customers SET payment_terms = NULL WHERE id = :id"),
                    {"id": cid},
                )
            else:
                conn.execute(
                    sa.text("UPDATE customers SET payment_terms = :j WHERE id = :id"),
                    {"j": json.dumps(d), "id": cid},
                )
        op.execute(sa.text('ALTER TABLE customers DROP COLUMN "payment_terms_old"'))
    else:
        rows = conn.execute(sa.text("SELECT id, payment_terms FROM customers")).fetchall()
        for row in rows:
            cid, old = row[0], row[1]
            d = _legacy_string_to_payment_terms_dict(old)
            if d is None:
                conn.execute(
                    sa.text("UPDATE customers SET payment_terms_new = NULL WHERE id = :id"),
                    {"id": cid},
                )
            else:
                conn.execute(
                    sa.text("UPDATE customers SET payment_terms_new = CAST(:j AS jsonb) WHERE id = :id"),
                    {"j": json.dumps(d), "id": cid},
                )
        op.drop_column("customers", "payment_terms")
        op.execute(sa.text("ALTER TABLE customers RENAME COLUMN payment_terms_new TO payment_terms"))


def _downgrade_payment_terms_to_string() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    if is_sqlite:
        op.add_column("customers", sa.Column("payment_terms_str", sa.String(length=255), nullable=True))
        rows = conn.execute(sa.text("SELECT id, payment_terms FROM customers")).fetchall()
        for row in rows:
            cid, j = row[0], row[1]
            if j is None or not isinstance(j, (dict, list)):
                s = None
            else:
                s = json.dumps(j)[:255] if isinstance(j, dict) else None
            conn.execute(
                sa.text("UPDATE customers SET payment_terms_str = :s WHERE id = :id"),
                {"s": s, "id": cid},
            )
        op.execute(sa.text('ALTER TABLE customers DROP COLUMN "payment_terms"'))
        op.execute(sa.text('ALTER TABLE customers RENAME COLUMN "payment_terms_str" TO "payment_terms"'))
    else:
        op.add_column("customers", sa.Column("payment_terms_str", sa.String(length=255), nullable=True))
        rows = conn.execute(sa.text("SELECT id, payment_terms FROM customers")).fetchall()
        for row in rows:
            cid, j = row[0], row[1]
            s = None
            if isinstance(j, dict):
                s = json.dumps(j)[:255]
            conn.execute(
                sa.text("UPDATE customers SET payment_terms_str = :s WHERE id = :id"),
                {"s": s, "id": cid},
            )
        op.drop_column("customers", "payment_terms")
        op.execute(sa.text("ALTER TABLE customers RENAME COLUMN payment_terms_str TO payment_terms"))


def _upgrade_remove_customer_code() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("customers") as batch_op:
            batch_op.drop_index("ix_customers_code")
            batch_op.drop_constraint("uq_customer_code", type_="unique")
            batch_op.drop_constraint("ck_customers_code_len", type_="check")
            batch_op.drop_column("code")
    else:
        op.drop_index("ix_customers_code", table_name="customers")
        op.drop_constraint("uq_customer_code", "customers", type_="unique")
        op.drop_constraint("ck_customers_code_len", "customers", type_="check")
        op.drop_column("customers", "code")


def upgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    # 1) MYOB customer linkage
    myob_cols = [
        sa.Column("myob_customer_uid", sa.String(length=36), nullable=True),
        sa.Column("myob_display_id", sa.String(length=128), nullable=True),
        sa.Column("myob_last_modified", sa.DateTime(timezone=True), nullable=True),
        sa.Column("myob_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("myob_notes", sa.Text(), nullable=True),
    ]

    if is_sqlite:
        with op.batch_alter_table("customers") as batch_op:
            for c in myob_cols:
                batch_op.add_column(c)
    else:
        for c in myob_cols:
            op.add_column("customers", c)

    op.create_index("ix_customers_myob_customer_uid", "customers", ["myob_customer_uid"], unique=True)

    # 2) payment_terms: string -> JSON
    _upgrade_payment_terms_to_json()

    # 3) remove customers.code
    _upgrade_remove_customer_code()


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    # 3) Cannot safely re-add short customer codes / constraints without defaults (skip)

    # 2) payment_terms: JSON -> string
    _downgrade_payment_terms_to_string()

    # 1) drop MYOB fields
    op.drop_index("ix_customers_myob_customer_uid", table_name="customers")
    drop_names = [
        "myob_notes",
        "myob_synced_at",
        "myob_last_modified",
        "myob_display_id",
        "myob_customer_uid",
    ]
    if is_sqlite:
        with op.batch_alter_table("customers") as batch_op:
            for name in drop_names:
                batch_op.drop_column(name)
    else:
        for name in drop_names:
            op.drop_column("customers", name)
