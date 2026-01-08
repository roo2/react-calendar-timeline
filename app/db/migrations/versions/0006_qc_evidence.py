from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0006_qc_evidence"
down_revision = "0005_inventory"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # QC Readings (sensor evidence)
    op.create_table(
        "qc_readings",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("operation_run_id", sa.String(length=36), sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sensor_id", sa.String(length=36), nullable=True),
        sa.Column("check_type", sa.String(length=100), nullable=False),
        sa.Column("value", sa.JSON, nullable=False),
        sa.Column("result", sa.Enum(name="qc_check_result", native_enum=False), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("source", sa.Enum(name="qc_source", native_enum=False), nullable=False, server_default=sa.text("'sensor'")),
    )
    op.create_index("ix_qc_readings_run", "qc_readings", ["operation_run_id"], unique=False)
    op.create_index("ix_qc_readings_sensor", "qc_readings", ["sensor_id"], unique=False)

    # QC Checks
    op.create_table(
        "qc_checks",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("operation_run_id", sa.String(length=36), sa.ForeignKey("operation_runs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("check_type", sa.String(length=100), nullable=False),
        sa.Column("required", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.Column("result", sa.Enum(name="qc_check_result", native_enum=False), nullable=True),
        sa.Column("numeric_values", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("measured_by", sa.String(length=100), nullable=True),
        sa.Column("timestamp", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("source", sa.Enum(name="qc_source", native_enum=False), nullable=False),
        sa.Column("reading_ref", sa.String(length=36), sa.ForeignKey("qc_readings.id", ondelete="RESTRICT"), nullable=True),
    )
    op.create_index("ix_qc_checks_run", "qc_checks", ["operation_run_id"], unique=False)

    # Job QC Summary (one per job)
    op.create_table(
        "job_qc_summaries",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("totals", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("aggregates", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("final_checklist", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("deviations", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.Enum(name="job_qc_summary_status", native_enum=False), nullable=False),
        sa.Column("created_by", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("finalized_by", sa.String(length=100), nullable=True),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", name="uq_job_qc_summary_job"),
    )
    op.create_index("ix_job_qc_summaries_job", "job_qc_summaries", ["job_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_job_qc_summaries_job", table_name="job_qc_summaries")
    op.drop_table("job_qc_summaries")
    op.drop_index("ix_qc_checks_run", table_name="qc_checks")
    op.drop_table("qc_checks")
    op.drop_index("ix_qc_readings_sensor", table_name="qc_readings")
    op.drop_index("ix_qc_readings_run", table_name="qc_readings")
    op.drop_table("qc_readings")


