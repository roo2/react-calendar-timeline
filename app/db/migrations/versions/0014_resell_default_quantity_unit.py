"""Add default quantity unit for resell products.

Revision ID: 0014_resell_default_unit
Revises: 0013_order_customer_po_number
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0014_resell_default_unit"
down_revision = "0013_order_customer_po_number"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("resell_products", sa.Column("default_quantity_unit", sa.String(length=16), nullable=True))


def downgrade() -> None:
    op.drop_column("resell_products", "default_quantity_unit")
