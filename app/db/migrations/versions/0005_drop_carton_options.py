"""Drop carton_options (per-carton-type pricing table; unused).

Revision ID: 0005_drop_carton_options
Revises: 0004_retail_conv_defaults
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_drop_carton_options"
down_revision = "0004_retail_conv_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_table("carton_options")


def downgrade() -> None:
    op.create_table(
        "carton_options",
        sa.Column("slug", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("cost_per_unit", sa.Numeric(12, 4), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.CheckConstraint("length(slug) > 0", name="ck_carton_options_slug_nonempty"),
        sa.CheckConstraint("cost_per_unit >= 0", name="ck_carton_options_cost_nonneg"),
    )
