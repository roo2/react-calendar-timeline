"""Resell catalog: distinguish supplies vs outsourced manufactured (MYOB-bought) products."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_resell_catalog_kind"
down_revision = "0011_myob_orders_unified"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "resell_products",
        sa.Column(
            "catalog_kind",
            sa.String(length=32),
            nullable=False,
            server_default="supply",
        ),
    )
    op.create_index("ix_resell_products_catalog_kind", "resell_products", ["catalog_kind"], unique=False)
    op.add_column("myob_item_selling_uoms", sa.Column("is_sold", sa.Boolean(), nullable=True))
    op.add_column("myob_item_selling_uoms", sa.Column("is_inventoried", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("myob_item_selling_uoms", "is_inventoried")
    op.drop_column("myob_item_selling_uoms", "is_sold")
    op.drop_index("ix_resell_products_catalog_kind", table_name="resell_products")
    op.drop_column("resell_products", "catalog_kind")
