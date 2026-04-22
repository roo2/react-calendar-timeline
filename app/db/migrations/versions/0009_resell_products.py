"""Resell / supplies catalog and order lines (cores, pallets, etc.).

Revision ID: 0009_resell_products
Revises: 0008_job_production_timestamps
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_resell_products"
down_revision = "0008_job_production_timestamps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "resell_products",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("unit_price", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
        ),
    )
    op.create_index("ix_resell_products_active", "resell_products", ["active"], unique=False)

    op.create_table(
        "order_resell_lines",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("order_id", sa.String(length=36), sa.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column(
            "resell_product_id",
            sa.String(length=36),
            sa.ForeignKey("resell_products.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("description_snapshot", sa.Text(), nullable=False),
        sa.Column("quantity_value", sa.Numeric(precision=18, scale=6), nullable=False),
        sa.Column("quantity_unit", sa.String(length=16), nullable=False, server_default="ea"),
        sa.Column("unit_rate", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("line_total", sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
    )
    op.create_index("ix_order_resell_lines_order", "order_resell_lines", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_order_resell_lines_order", table_name="order_resell_lines")
    op.drop_table("order_resell_lines")
    op.drop_index("ix_resell_products_active", table_name="resell_products")
    op.drop_table("resell_products")
