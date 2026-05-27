"""Extruders: unavailable flag for scheduling and job sheet selection."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_extruders_is_broken"
down_revision = "0034_default_order_waste_pct"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("extruders")}

    if "is_broken" not in existing_cols:
        op.add_column(
            "extruders",
            sa.Column("is_broken", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing_cols = {c["name"] for c in insp.get_columns("extruders")}

    if "is_broken" in existing_cols:
        op.drop_column("extruders", "is_broken")
