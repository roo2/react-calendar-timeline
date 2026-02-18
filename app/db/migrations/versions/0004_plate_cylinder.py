from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004_plate_cylinder"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("plates") as batch_op:
        batch_op.add_column(sa.Column("cylinder", sa.String(length=64), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("plates") as batch_op:
        batch_op.drop_column("cylinder")

