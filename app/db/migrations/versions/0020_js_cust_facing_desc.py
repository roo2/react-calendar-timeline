"""Job sheet customer-facing description (optional override of import line text).

Revision ID: 0020_js_cust_facing_desc
Revises: 0019_order_import_review_status
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_js_cust_facing_desc"
down_revision = "0019_order_import_review_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("job_sheets", schema=None) as batch:
        batch.add_column(sa.Column("customer_facing_description", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("job_sheets", schema=None) as batch:
        batch.drop_column("customer_facing_description")
