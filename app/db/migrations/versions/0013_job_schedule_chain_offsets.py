"""Persist Gantt chain offsets (operating hours from extrusion start to Uteco / bagging starts)."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0013_job_schedule_chain_offsets"
down_revision = "0012_queue_scheduled_start_utc"
branch_labels = None
depends_on = None


def upgrade() -> None:
	op.add_column(
		"jobs",
		sa.Column("schedule_chain_uteco_offset_operating_hours", sa.Numeric(18, 6), nullable=True),
	)
	op.add_column(
		"jobs",
		sa.Column("schedule_chain_bagging_offset_operating_hours", sa.Numeric(18, 6), nullable=True),
	)


def downgrade() -> None:
	op.drop_column("jobs", "schedule_chain_bagging_offset_operating_hours")
	op.drop_column("jobs", "schedule_chain_uteco_offset_operating_hours")
