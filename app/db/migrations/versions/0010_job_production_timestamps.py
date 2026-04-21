"""Job production start/finish timestamps; retire paused/completed job statuses.

Revision ID: 0010_job_production_timestamps
Revises: 0009_quote_form_margins
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0010_job_production_timestamps"
down_revision = "0009_quote_form_margins"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("jobs") as batch_op:
            batch_op.add_column(sa.Column("production_started_at", sa.DateTime(timezone=True), nullable=True))
            batch_op.add_column(sa.Column("production_finished_at", sa.DateTime(timezone=True), nullable=True))
    else:
        op.add_column("jobs", sa.Column("production_started_at", sa.DateTime(timezone=True), nullable=True))
        op.add_column("jobs", sa.Column("production_finished_at", sa.DateTime(timezone=True), nullable=True))

    # Legacy enum values removed from app: map to running (shop floor still in progress or awaiting dispatch).
    op.execute(sa.text("UPDATE jobs SET status = 'running' WHERE status IN ('paused', 'completed')"))


def downgrade() -> None:
    conn = op.get_bind()
    is_sqlite = conn.dialect.name == "sqlite"

    if is_sqlite:
        with op.batch_alter_table("jobs") as batch_op:
            batch_op.drop_column("production_finished_at")
            batch_op.drop_column("production_started_at")
    else:
        op.drop_column("jobs", "production_finished_at")
        op.drop_column("jobs", "production_started_at")
