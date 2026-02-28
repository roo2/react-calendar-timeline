from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005_customer_drop_credit_and_internal_notes"
down_revision = "0004_customer_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("customers") as batch_op:
        batch_op.drop_column("credit_limit")
        batch_op.drop_column("internal_notes")


def downgrade() -> None:
    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("credit_limit", sa.Numeric(18, 2), nullable=True))
        batch_op.add_column(sa.Column("internal_notes", sa.Text(), nullable=True))

