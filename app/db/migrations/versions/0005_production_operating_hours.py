"""Production operating hours + calendar exceptions for Gantt scheduling."""

from __future__ import annotations

import json

from alembic import op
import sqlalchemy as sa

revision = "0005_production_operating_hours"
down_revision = "0003_views_and_seeds"
branch_labels = None
depends_on = None

_DEFAULT_WEEK = {
    "monday": {"enabled": True, "start": "00:00", "end": "24:00"},
    "tuesday": {"enabled": True, "start": "00:00", "end": "24:00"},
    "wednesday": {"enabled": True, "start": "00:00", "end": "24:00"},
    "thursday": {"enabled": True, "start": "00:00", "end": "24:00"},
    "friday": {"enabled": True, "start": "00:00", "end": "16:30"},
    "saturday": {"enabled": False, "start": "00:00", "end": "24:00"},
    "sunday": {"enabled": False, "start": "00:00", "end": "24:00"},
}


def upgrade() -> None:
    conn = op.get_bind()
    _false = sa.text("false") if conn.dialect.name == "postgresql" else sa.text("0")

    op.create_table(
        "production_operating_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("timezone", sa.String(64), nullable=False, server_default="Australia/Brisbane"),
        sa.Column("gantt_preview_weeks", sa.Integer(), nullable=False, server_default="4"),
        sa.Column("week_json", sa.JSON(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_production_operating_settings_singleton"),
        sa.CheckConstraint("gantt_preview_weeks >= 1 AND gantt_preview_weeks <= 52", name="ck_gantt_preview_weeks_range"),
    )

    week_json = json.dumps(_DEFAULT_WEEK)
    conn.execute(
        sa.text(
            "INSERT INTO production_operating_settings (id, timezone, gantt_preview_weeks, week_json) "
            "VALUES (1, 'Australia/Brisbane', 4, :wj)"
        ),
        {"wj": week_json},
    )

    op.create_table(
        "production_calendar_exceptions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("exception_date", sa.Date(), nullable=False),
        sa.Column("closed", sa.Boolean(), nullable=False, server_default=_false),
        sa.Column("open_time", sa.String(8), nullable=True),
        sa.Column("close_time", sa.String(8), nullable=True),
        sa.Column("note", sa.String(255), nullable=True),
        sa.UniqueConstraint("exception_date", name="uq_production_calendar_exception_date"),
    )
    op.create_index("ix_production_calendar_exceptions_date", "production_calendar_exceptions", ["exception_date"])


def downgrade() -> None:
    op.drop_index("ix_production_calendar_exceptions_date", table_name="production_calendar_exceptions")
    op.drop_table("production_calendar_exceptions")
    op.drop_table("production_operating_settings")
