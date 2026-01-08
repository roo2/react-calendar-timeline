from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004_runs_outputs"
down_revision = "0003_machines_orders_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Operation runs
    op.create_table(
        "operation_runs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("operation_type", sa.Enum(name="operation_type", native_enum=False), nullable=False),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("status", sa.Enum(name="run_status", native_enum=False), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_operation_runs_job", "operation_runs", ["job_id"], unique=False)
    op.create_index("ix_operation_runs_machine", "operation_runs", ["machine_id"], unique=False)

    # Run outputs (append-only)
    op.create_table(
        "run_output_entries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("run_id", sa.String(length=36), sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("uom", sa.String(length=32), nullable=False),
        sa.Column("good_or_scrap", sa.Boolean, nullable=False),
        sa.Column("finished_goods", sa.Boolean, nullable=False, server_default=sa.text("FALSE")),
        sa.Column("note", sa.Text, nullable=True),
    )
    op.create_index("ix_run_output_entries_run", "run_output_entries", ["run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_run_output_entries_run", table_name="run_output_entries")
    op.drop_table("run_output_entries")
    op.drop_index("ix_operation_runs_machine", table_name="operation_runs")
    op.drop_index("ix_operation_runs_job", table_name="operation_runs")
    op.drop_table("operation_runs")


