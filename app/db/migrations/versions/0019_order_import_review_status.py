"""Order import review status (manual complete vs incomplete).

Revision ID: 0019_order_import_review_status
Revises: 0018_myob_order_source_json
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_order_import_review_status"
down_revision = "0018_myob_order_source_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("orders", schema=None) as batch:
        batch.add_column(sa.Column("import_review_status", sa.String(length=16), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("orders", schema=None) as batch:
        batch.drop_column("import_review_status")
