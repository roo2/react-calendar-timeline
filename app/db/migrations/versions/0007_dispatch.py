from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0007_dispatch"
down_revision = "0006_qc_evidence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dispatch_records",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False, unique=True),
        sa.Column("order_id", sa.String(length=36), sa.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("dispatch_status", sa.Enum(name="dispatch_status", native_enum=False), nullable=False),
        sa.Column("packaging", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("dispatch_metadata", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("first_run_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", name="uq_dispatch_job"),
    )
    op.create_index("ix_dispatch_records_order", "dispatch_records", ["order_id"], unique=False)
    op.create_index("ix_dispatch_records_job", "dispatch_records", ["job_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_dispatch_records_job", table_name="dispatch_records")
    op.drop_index("ix_dispatch_records_order", table_name="dispatch_records")
    op.drop_table("dispatch_records")


