from __future__ import annotations

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0003_machines_orders_jobs"
down_revision = "0002_core_parties_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Machines
    op.create_table(
        "machines",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("type", sa.Enum(name="machine_type", native_enum=False), nullable=False),
        sa.Column("capability", sa.JSON, nullable=False, server_default=sa.text("'{}'")),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.text("TRUE")),
        sa.UniqueConstraint("code", name="uq_machine_code"),
    )
    op.create_index("ix_machines_code", "machines", ["code"], unique=True)

    # Orders
    op.create_table(
        "orders",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("code", sa.String(length=32), nullable=False, unique=True),
        sa.Column("customer_id", sa.String(length=36), sa.ForeignKey("customers.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("product_version_id", sa.String(length=36), sa.ForeignKey("product_versions.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("quote_id", sa.String(length=36), nullable=True),
        sa.Column("status", sa.Enum(name="order_status", native_enum=False), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("code", name="uq_order_code"),
    )
    op.create_index("ix_orders_code", "orders", ["code"], unique=True)
    op.create_index("ix_orders_customer", "orders", ["customer_id"], unique=False)
    op.create_index("ix_orders_product_version", "orders", ["product_version_id"], unique=False)

    # Jobs
    op.create_table(
        "jobs",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("order_id", sa.String(length=36), sa.ForeignKey("orders.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("job_code", sa.Integer, nullable=False),
        sa.Column("run_index", sa.Integer, nullable=False, server_default=sa.text("0")),
        sa.Column("planned_qty", sa.Numeric(18, 6), nullable=False),
        sa.Column("produced_qty", sa.Numeric(18, 6), nullable=False, server_default=sa.text("0")),
        sa.Column("status", sa.Enum(name="job_status", native_enum=False), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("order_id", "job_code", name="uq_job_order_jobcode"),
    )
    op.create_index("ix_jobs_order", "jobs", ["order_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_jobs_order", table_name="jobs")
    op.drop_table("jobs")
    op.drop_index("ix_orders_product_version", table_name="orders")
    op.drop_index("ix_orders_customer", table_name="orders")
    op.drop_index("ix_orders_code", table_name="orders")
    op.drop_table("orders")
    op.drop_index("ix_machines_code", table_name="machines")
    op.drop_table("machines")


