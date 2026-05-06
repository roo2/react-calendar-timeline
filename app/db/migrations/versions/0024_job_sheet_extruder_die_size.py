"""Product: production extruder code + die size (free text).

Stored on ``products`` so all job sheets for the same product share extrusion tooling.

Revision ID: 0024_job_sheet_extruder_die_size
Revises: 0023_customer_pricing_tiers
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_job_sheet_extruder_die_size"
down_revision = "0023_customer_pricing_tiers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("production_extruder_code", sa.String(length=64), nullable=True))
    op.add_column("products", sa.Column("die_size", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "die_size")
    op.drop_column("products", "production_extruder_code")
