from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005_remove_order_currency"
down_revision = "0004_plate_cylinder"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLite requires batch mode for dropping columns.
    with op.batch_alter_table("orders") as batch_op:
        batch_op.drop_column("currency")


def downgrade() -> None:
    with op.batch_alter_table("orders") as batch_op:
        batch_op.add_column(sa.Column("currency", sa.String(length=3), nullable=False, server_default=sa.text("'AUD'")))
