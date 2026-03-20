"""anilox master table for Uteco printing specs."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0004_anilox"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "anilox",
        sa.Column("anilox_code", sa.String(length=32), primary_key=True, nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("anilox")
