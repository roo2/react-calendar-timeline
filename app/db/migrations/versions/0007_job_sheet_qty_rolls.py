"""Job sheet: qty_type, num_product_units, weight_per_roll_kg, num_rolls for scheduling."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_job_sheet_qty_rolls"
down_revision = "0006_jobs_standalone_job_sheet"
branch_labels = None
depends_on = None


def upgrade() -> None:
	op.add_column(
		"job_sheets",
		sa.Column("qty_type", sa.String(16), nullable=False, server_default="kg"),
	)
	op.add_column("job_sheets", sa.Column("num_product_units", sa.Numeric(18, 6), nullable=True))
	op.add_column("job_sheets", sa.Column("weight_per_roll_kg", sa.Numeric(18, 6), nullable=True))
	op.add_column(
		"job_sheets",
		sa.Column("num_rolls", sa.Integer(), nullable=False, server_default="1"),
	)


def downgrade() -> None:
	op.drop_column("job_sheets", "num_rolls")
	op.drop_column("job_sheets", "weight_per_roll_kg")
	op.drop_column("job_sheets", "num_product_units")
	op.drop_column("job_sheets", "qty_type")
