"""machine_queue_items.operating_hours_lead_before for Gantt gaps / hour slots."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0009_queue_lead"
down_revision = "0008_extrusion_tool_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
	op.add_column(
		"machine_queue_items",
		sa.Column(
			"operating_hours_lead_before",
			sa.Numeric(14, 4),
			server_default="0",
			nullable=False,
		),
	)


def downgrade() -> None:
	op.drop_column("machine_queue_items", "operating_hours_lead_before")
