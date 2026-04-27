"""Add customer purchase order number on orders."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_order_customer_po_number"
down_revision = "0012_resell_catalog_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("customer_purchase_order_number", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "customer_purchase_order_number")
