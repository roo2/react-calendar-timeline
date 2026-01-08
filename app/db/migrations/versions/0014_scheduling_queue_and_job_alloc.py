from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0014_scheduling_queue_and_job_alloc"
down_revision = "0013_seed_auth_users"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create queue_status enum for machine queue items
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute(
            sa.text(
                "CREATE TYPE queue_status AS ENUM ('queued','running','completed','removed')"
            )
        )

    # Add allocated_order_units to jobs (SDS 5 — fulfilment allocation)
    op.add_column(
        "jobs",
        sa.Column("allocated_order_units", sa.Numeric(18, 6), nullable=True),
    )

    # Create machine_queue_items table (SDS 6 §4.1)
    op.create_table(
        "machine_queue_items",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("machine_id", sa.String(length=36), sa.ForeignKey("machines.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("job_id", sa.String(length=36), sa.ForeignKey("jobs.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("status", sa.Enum(name="queue_status", native_enum=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("machine_id", "position", name="uq_queue_machine_position"),
    )
    op.create_index("ix_queue_machine", "machine_queue_items", ["machine_id"], unique=False)
    op.create_index("ix_queue_job", "machine_queue_items", ["job_id"], unique=False)


def downgrade() -> None:
    # Drop queue table
    op.drop_index("ix_queue_job", table_name="machine_queue_items")
    op.drop_index("ix_queue_machine", table_name="machine_queue_items")
    op.drop_table("machine_queue_items")

    # Drop allocated_order_units column
    op.drop_column("jobs", "allocated_order_units")

    # Drop enum (PostgreSQL only)
    conn = op.get_bind()
    if conn.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS queue_status")


