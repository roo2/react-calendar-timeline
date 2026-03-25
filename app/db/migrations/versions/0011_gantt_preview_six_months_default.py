"""Default Gantt preview window ~6 months (26 weeks) for calendar + inactive intervals."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_gantt_preview_six_months"
down_revision = "0010_schedule_queues_split"
branch_labels = None
depends_on = None


def upgrade() -> None:
	conn = op.get_bind()
	is_sqlite = conn.dialect.name == "sqlite"
	# SQLite has no ALTER COLUMN … SET DEFAULT; PG does. Data UPDATE applies on all backends.
	if not is_sqlite:
		op.alter_column(
			"production_operating_settings",
			"gantt_preview_weeks",
			server_default="26",
		)
	# Migrate rows still on the old factory default without changing custom values.
	op.execute(
		sa.text("UPDATE production_operating_settings SET gantt_preview_weeks = 26 WHERE gantt_preview_weeks = 4")
	)


def downgrade() -> None:
	conn = op.get_bind()
	if conn.dialect.name != "sqlite":
		op.alter_column(
			"production_operating_settings",
			"gantt_preview_weeks",
			server_default="4",
		)
