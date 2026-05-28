"""Track Xero invoice exports on orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038_order_xero_invoice_export"
down_revision = "0037_order_gst_metadata"
branch_labels = None
depends_on = None


def _cols(table_name: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {c["name"] for c in insp.get_columns(table_name)}


def _indexes(table_name: str) -> set[str]:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    return {idx["name"] for idx in insp.get_indexes(table_name) if idx.get("name")}


def upgrade() -> None:
    order_cols = _cols("orders")
    if "xero_invoice_id" not in order_cols:
        op.add_column("orders", sa.Column("xero_invoice_id", sa.String(length=36), nullable=True))
    if "xero_invoice_number" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("xero_invoice_number", sa.String(length=64), nullable=True),
        )
    if "xero_invoice_exported_at" not in order_cols:
        op.add_column(
            "orders",
            sa.Column("xero_invoice_exported_at", sa.DateTime(timezone=True), nullable=True),
        )

    indexes = _indexes("orders")
    if "ix_orders_xero_invoice_id" not in indexes:
        op.create_index(
            "ix_orders_xero_invoice_id",
            "orders",
            ["xero_invoice_id"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    is_sqlite = bind.dialect.name == "sqlite"
    order_cols = _cols("orders")
    indexes = _indexes("orders")

    if is_sqlite:
        if {
            "xero_invoice_id",
            "xero_invoice_number",
            "xero_invoice_exported_at",
        } & order_cols:
            with op.batch_alter_table("orders", recreate="always") as batch:
                if "ix_orders_xero_invoice_id" in indexes:
                    batch.drop_index("ix_orders_xero_invoice_id")
                if "xero_invoice_exported_at" in order_cols:
                    batch.drop_column("xero_invoice_exported_at")
                if "xero_invoice_number" in order_cols:
                    batch.drop_column("xero_invoice_number")
                if "xero_invoice_id" in order_cols:
                    batch.drop_column("xero_invoice_id")
        return

    if "ix_orders_xero_invoice_id" in indexes:
        op.drop_index("ix_orders_xero_invoice_id", table_name="orders")
    if "xero_invoice_exported_at" in order_cols:
        op.drop_column("orders", "xero_invoice_exported_at")
    if "xero_invoice_number" in order_cols:
        op.drop_column("orders", "xero_invoice_number")
    if "xero_invoice_id" in order_cols:
        op.drop_column("orders", "xero_invoice_id")
