"""Persist MYOB background import pipeline job state (poll + resume after worker restart).

Revision ID: 0016_myob_import_jobs
Revises: 0015_resell_customer_scope
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

revision = "0016_myob_import_jobs"
down_revision = "0015_resell_customer_scope"
branch_labels = None
depends_on = None


def _is_sqlite(conn) -> bool:
    return conn.dialect.name == "sqlite"


def _is_postgres(conn) -> bool:
    return conn.dialect.name == "postgresql"


def upgrade() -> None:
    op.create_table(
        "myob_import_jobs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("phase", sa.String(length=32), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("orders_mode", sa.String(length=16), nullable=False),
        sa.Column("orders_top", sa.Integer(), nullable=False),
        sa.Column("orders_skip", sa.Integer(), nullable=False),
        sa.Column("partial", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("result", sa.JSON(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_myob_import_jobs"),
    )
    op.create_index("ix_myob_import_jobs_status", "myob_import_jobs", ["status"], unique=False)
    op.create_index("ix_myob_import_jobs_updated_at", "myob_import_jobs", ["updated_at"], unique=False)

    conn = op.get_bind()
    # At most one running job app-wide (Postgres). SQLite test DBs rely on app-level checks only.
    if _is_postgres(conn):
        op.execute(
            text(
                "CREATE UNIQUE INDEX uq_myob_import_jobs_one_running "
                "ON myob_import_jobs ((1)) WHERE status = 'running'"
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    if _is_postgres(conn):
        op.execute(text("DROP INDEX IF EXISTS uq_myob_import_jobs_one_running"))
    op.drop_index("ix_myob_import_jobs_updated_at", table_name="myob_import_jobs")
    op.drop_index("ix_myob_import_jobs_status", table_name="myob_import_jobs")
    op.drop_table("myob_import_jobs")
