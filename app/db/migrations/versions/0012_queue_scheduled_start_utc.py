"""Per-queue-item wall start (UTC) for independent Gantt placement; backfill from legacy lead model."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0012_queue_scheduled_start_utc"
down_revision = "0011_gantt_preview_six_months"
branch_labels = None
depends_on = None


def upgrade() -> None:
	op.add_column(
		"extrusion_queue_items",
		sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
	)
	op.add_column(
		"uteco_queue_items",
		sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
	)
	op.add_column(
		"bagging_queue_items",
		sa.Column("scheduled_start_utc", sa.DateTime(timezone=True), nullable=True),
	)

	from app.db.session import SessionLocal  # noqa: E402
	from app.scheduling.service import backfill_queue_scheduled_starts_from_lead_model  # noqa: E402

	with SessionLocal.begin() as session:
		backfill_queue_scheduled_starts_from_lead_model(session)


def downgrade() -> None:
	op.drop_column("bagging_queue_items", "scheduled_start_utc")
	op.drop_column("uteco_queue_items", "scheduled_start_utc")
	op.drop_column("extrusion_queue_items", "scheduled_start_utc")
