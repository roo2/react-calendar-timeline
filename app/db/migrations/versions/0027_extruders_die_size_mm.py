"""Add die_size_mm to rate-card extruders (shop TSV / job sheet print).

Revision ID: 0027_extruders_die_size_mm
Revises: 0026_colour_hex_codes
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "0027_extruders_die_size_mm"
down_revision = "0026_colour_hex_codes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("extruders") as batch_op:
        batch_op.add_column(sa.Column("die_size_mm", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("extruders") as batch_op:
        batch_op.drop_column("die_size_mm")
