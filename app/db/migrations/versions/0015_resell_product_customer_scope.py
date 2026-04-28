"""Resell products: optional customer for outsourced MYOB rows; composite uniqueness on MYOB UID.

Revision ID: 0015_resell_customer_scope
Revises: 0014_resell_default_unit
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "0015_resell_customer_scope"
down_revision = "0014_resell_default_unit"
branch_labels = None
depends_on = None


def _is_sqlite(conn) -> bool:
    return conn.dialect.name == "sqlite"


def upgrade() -> None:
    conn = op.get_bind()
    op.drop_index("ix_resell_products_myob_item_uid", table_name="resell_products")

    if _is_sqlite(conn):
        with op.batch_alter_table("resell_products", schema=None) as batch:
            batch.add_column(sa.Column("customer_id", sa.String(length=36), nullable=True))
            batch.create_index("ix_resell_products_customer_id", ["customer_id"], unique=False)
            batch.create_foreign_key(
                "fk_resell_products_customer",
                "customers",
                ["customer_id"],
                ["id"],
                ondelete="SET NULL",
            )
        op.execute(
            text(
                "CREATE UNIQUE INDEX uq_resell_products_myob_uid_customer_outsourced "
                "ON resell_products (myob_item_uid, customer_id) "
                "WHERE myob_item_uid IS NOT NULL AND catalog_kind = 'outsourced_manufacturing'"
            )
        )
    else:
        op.add_column(
            "resell_products",
            sa.Column("customer_id", sa.String(length=36), nullable=True),
        )
        op.create_index(
            "ix_resell_products_customer_id",
            "resell_products",
            ["customer_id"],
            unique=False,
        )
        op.create_foreign_key(
            "fk_resell_products_customer",
            "resell_products",
            "customers",
            ["customer_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.execute(
            text(
                "CREATE UNIQUE INDEX uq_resell_products_myob_uid_customer_outsourced "
                "ON resell_products (myob_item_uid, customer_id) "
                "WHERE myob_item_uid IS NOT NULL AND catalog_kind = 'outsourced_manufacturing'"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _is_sqlite(conn):
        op.execute(text("DROP INDEX uq_resell_products_myob_uid_customer_outsourced"))
        with op.batch_alter_table("resell_products", schema=None) as batch:
            batch.drop_constraint("fk_resell_products_customer", type_="foreignkey")
            batch.drop_index("ix_resell_products_customer_id")
            batch.drop_column("customer_id")
        op.create_index(
            "ix_resell_products_myob_item_uid",
            "resell_products",
            ["myob_item_uid"],
            unique=True,
        )
    else:
        op.execute(text("DROP INDEX uq_resell_products_myob_uid_customer_outsourced"))
        op.drop_constraint("fk_resell_products_customer", "resell_products", type_="foreignkey")
        op.drop_index("ix_resell_products_customer_id", table_name="resell_products")
        op.drop_column("resell_products", "customer_id")
        op.create_index(
            "ix_resell_products_myob_item_uid",
            "resell_products",
            ["myob_item_uid"],
            unique=True,
        )
