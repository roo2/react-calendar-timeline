"""Persist raw MYOB sales-order + associated invoice JSON on orders.

Revision ID: 0018_myob_order_source_json
Revises: 0017_inc_acct_brand
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018_myob_order_source_json"
down_revision = "0017_inc_acct_brand"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("orders", schema=None) as batch:
        batch.add_column(sa.Column("myob_source_sales_order_json", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("myob_source_invoices_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("orders", schema=None) as batch:
        batch.drop_column("myob_source_invoices_json")
        batch.drop_column("myob_source_sales_order_json")
