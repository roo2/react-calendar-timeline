from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004_customer_fields"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    is_pg = conn.dialect.name == "postgresql"
    false_default = sa.text("false") if is_pg else sa.text("0")

    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("contact_phone", sa.String(length=50), nullable=True))
        batch_op.add_column(sa.Column("deposit_required", sa.Boolean(), nullable=False, server_default=false_default))
        batch_op.add_column(sa.Column("deposit_pct", sa.Numeric(5, 2), nullable=True))

        # Remove legacy fields
        batch_op.drop_column("tax_id")


def downgrade() -> None:
    conn = op.get_bind()
    is_pg = conn.dialect.name == "postgresql"
    false_default = sa.text("false") if is_pg else sa.text("0")

    with op.batch_alter_table("customers") as batch_op:
        batch_op.add_column(sa.Column("tax_id", sa.String(length=50), nullable=True))
        batch_op.drop_column("deposit_pct")
        batch_op.drop_column("deposit_required")
        batch_op.drop_column("contact_phone")

